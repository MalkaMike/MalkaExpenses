import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { findReceiptsForTransactionV2 } from "@/lib/gmail/find-receipt-v2";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  /** Max transactions to process this call. v2 is slower (PDF + OCR) so default smaller. */
  limit: z.number().int().min(1).max(20).optional()
});

// POST /api/admin/gmail/batch-find
//
// Processes up to N transactions that have never been searched for receipts.
// Designed to be called repeatedly from the client until done. Each call
// processes ~30 transactions in ≤60 seconds.
//
// Returns: { processed, found, remaining, done }
//   processed — how many we tried this batch
//   found     — how many had ≥1 match
//   remaining — transactions still unsearched after this batch
//   done      — true if no more work to do
//
// Idempotent: skips transactions where gmail_searched_at IS NOT NULL.
// Sets gmail_searched_at + gmail_match_count even when 0 matches found —
// so empty results are cached and we never re-search them.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  // v2 search downloads PDFs + runs OCR → ~5-10s per transaction.
  // 10 transactions per 60s call leaves room for slow PDFs.
  const limit = parsed.data.limit ?? 10;

  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  const sb = serverClient();
  await preloadClusters();

  // Pull the next chunk of unsearched transactions.
  const { data: txs } = await sb
    .from("transactions")
    .select("id, date, description_raw, real_amount, is_transfer")
    .is("gmail_searched_at", null)
    .eq("is_transfer", false)
    .lt("real_amount", 0)
    .order("date", { ascending: false })
    .limit(limit);

  if (!txs || txs.length === 0) {
    return NextResponse.json({ processed: 0, found: 0, remaining: 0, done: true });
  }

  let processed = 0;
  let found = 0;
  let errors = 0;

  for (const tx of txs) {
    processed++;
    const absAmount = Math.abs(Number(tx.real_amount));
    try {
      const cluster = clusterFor(tx.description_raw as string);
      const matches = await findReceiptsForTransactionV2({
        accessToken: cred.accessToken,
        merchantName: cluster.name,
        date: tx.date as string,
        amount: absAmount,
        dayWindow: 7,
        max: 5
      });

      if (matches.length > 0) {
        found++;
        await sb.from("transaction_receipts").upsert(
          matches.map((m) => ({
            transaction_id: tx.id as string,
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
            amount_brl: absAmount
          })),
          { onConflict: "transaction_id,gmail_message_id" }
        );
      }

      await sb
        .from("transactions")
        .update({
          gmail_searched_at: new Date().toISOString(),
          gmail_match_count: matches.length
        })
        .eq("id", tx.id as string);
    } catch (e) {
      errors++;
      // Don't bail the whole batch — mark this one as failed-search and continue.
      // gmail_match_count stays 0; gmail_searched_at gets set so we don't loop.
      await sb
        .from("transactions")
        .update({
          gmail_searched_at: new Date().toISOString(),
          gmail_match_count: 0
        })
        .eq("id", tx.id as string);
    }
  }

  // Remaining unsearched count
  const { count: remaining } = await sb
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .is("gmail_searched_at", null)
    .eq("is_transfer", false)
    .lt("real_amount", 0);

  return NextResponse.json({
    processed,
    found,
    errors,
    remaining: remaining ?? 0,
    done: (remaining ?? 0) === 0
  });
}
