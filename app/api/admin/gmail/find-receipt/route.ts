import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getReceiptSearchCredentials } from "@/lib/gmail/oauth";
import {
  findReceiptsForTransactionV2,
  type ReceiptMatchV2
} from "@/lib/gmail/find-receipt-v2";
import { gmailMessageUrl } from "@/lib/gmail/message-url";
import { safeJson } from "@/lib/http";
import { fromDb } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  transaction_id: z.string().uuid(),
  merchant_name: z.string().min(1).max(200),
  refresh: z.boolean().optional()
});

// POST /api/admin/gmail/find-receipt
// v2: value-verified search. Only returns Gmail messages where the exact
// transaction amount was found (in subject, snippet, PDF text, or OCR).
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { transaction_id, merchant_name, refresh } = parsed.data;

  const sb = serverClient();

  // Fetch the transaction
  const { data: tx } = await sb
    .from("transactions")
    .select("id, date, real_amount, description_raw, gmail_searched_at")
    .eq("id", transaction_id)
    .maybeSingle();
  if (!tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  const absAmount = Math.abs(fromDb(Number(tx.real_amount)));

  // Return cached results unless refresh=true
  if (!refresh) {
    const { data: cached } = await sb
      .from("transaction_receipts")
      .select("*")
      .eq("transaction_id", transaction_id)
      .order("confidence", { ascending: true })  // verified < high alphabetically — fix below
      .order("created_at", { ascending: false });
    if (cached && cached.length > 0) {
      const sorted = cached.sort((a, b) => {
        // verified > high
        const ra = a.confidence === "verified" ? 2 : 1;
        const rb = b.confidence === "verified" ? 2 : 1;
        return rb - ra;
      });
      return NextResponse.json({
        cached: true,
        matches: sorted.map((r) => ({
          id: r.id,
          gmailMessageId: r.gmail_message_id,
          gmailThreadId: r.gmail_thread_id,
          subject: r.subject,
          fromEmail: r.from_email,
          fromName: r.from_name,
          sentAt: r.sent_at,
          hasAttachment: r.has_attachment,
          attachmentCount: r.attachment_count,
          confidence: r.confidence ?? "high",
          matchSource: r.match_source ?? "subject",
          matchReason: r.match_reason ?? "",
          matchSnippet: r.match_snippet ?? "",
          confirmed: r.confirmed,
          gmailUrl: gmailMessageUrl(r.gmail_message_id as string, r.source_email as string | null)
        }))
      });
    }
    // No cached receipts — but if we ALREADY searched this transaction and it
    // came back empty, honor the search-once guarantee: don't re-hit Gmail.
    // (Without this, every 0-match transaction re-searched Gmail on each click.)
    if (tx.gmail_searched_at) {
      return NextResponse.json({ cached: true, matches: [] });
    }
  }

  // Live search — across EVERY connected mailbox (work + personal), same as
  // the nightly cron. Which mailbox holds a given receipt is not knowable in
  // advance, so both are searched and the results merged.
  const creds = await getReceiptSearchCredentials();
  if (creds.length === 0) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  let matches: ReceiptMatchV2[];
  try {
    matches = [];
    for (const cred of creds) {
      const found = await findReceiptsForTransactionV2({
        accessToken: cred.accessToken,
        merchantName: merchant_name,
        date: tx.date as string,
        amount: absAmount,
        description: tx.description_raw as string | undefined,
        accountEmail: cred.email,
        dayWindow: 7,
        max: 5
      });
      matches.push(...found);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Gmail search failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Refresh the cache WITHOUT destroying admin triage.
  // Old behavior was DELETE+INSERT, which (a) wiped the `confirmed` flag on
  // every refresh and (b) raced to a 500 on a double-click. Instead:
  //   • upsert on the natural key → re-matched rows KEEP their `confirmed`
  //     value (we never send `confirmed` in the payload), new rows arrive NULL;
  //   • prune only STALE + UNCONFIRMED rows (no longer matched, never triaged).
  const newIds = new Set(matches.map((m) => m.gmailMessageId));
  const { data: existingRows } = await sb
    .from("transaction_receipts")
    .select("id, gmail_message_id, confirmed")
    .eq("transaction_id", transaction_id);
  const staleIds = (existingRows ?? [])
    .filter((r) => !newIds.has(r.gmail_message_id as string) && r.confirmed == null)
    .map((r) => r.id as string);
  if (staleIds.length > 0) {
    const { error: delErr } = await sb.from("transaction_receipts").delete().in("id", staleIds);
    if (delErr) console.error("[find-receipt] stale delete failed:", delErr.message);
  }
  if (matches.length > 0) {
    const { error: upsertErr } = await sb.from("transaction_receipts").upsert(
      matches.map((m) => ({
        transaction_id,
        gmail_message_id: m.gmailMessageId,
        gmail_thread_id: m.gmailThreadId,
        subject: m.subject,
        from_email: m.fromEmail,
        from_name: m.fromName,
        sent_at: m.sentAt,
        has_attachment: m.hasAttachment,
        attachment_count: m.attachmentCount,
        match_score: m.confidence === "verified" ? 1.0 : 0.75,
        match_reason: m.matchReason,
        confidence: m.confidence,
        match_source: m.matchSource,
        match_snippet: m.matchSnippet,
        amount_brl: absAmount,
        source_email: m.sourceEmail ?? null
      })),
      { onConflict: "transaction_id,gmail_message_id" }
    );
    // Found receipts that fail to save = permanent loss (the row gets stamped
    // as searched below and never re-searched). Surface it to the UI instead.
    if (upsertErr) {
      return NextResponse.json({ error: `receipt save failed: ${upsertErr.message}` }, { status: 500 });
    }
  }

  // Mark transaction as searched. A successful manual refresh also clears any
  // prior search error so the row leaves the retry pool.
  const { error: stampErr } = await sb
    .from("transactions")
    .update({
      gmail_searched_at: new Date().toISOString(),
      gmail_match_count: matches.length,
      gmail_search_error: null
    })
    .eq("id", transaction_id);
  if (stampErr) console.error("[find-receipt] mark-searched failed:", stampErr.message);

  return NextResponse.json({ cached: false, matches });
}
