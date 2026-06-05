import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { findReceiptsForTransactionV2 } from "@/lib/gmail/find-receipt-v2";

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

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { transaction_id, merchant_name, refresh } = parsed.data;

  const sb = serverClient();

  // Fetch the transaction
  const { data: tx } = await sb
    .from("transactions")
    .select("id, date, real_amount")
    .eq("id", transaction_id)
    .maybeSingle();
  if (!tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  const absAmount = Math.abs(Number(tx.real_amount));

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
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${r.gmail_message_id}`
        }))
      });
    }
  }

  // Live search
  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  let matches;
  try {
    matches = await findReceiptsForTransactionV2({
      accessToken: cred.accessToken,
      merchantName: merchant_name,
      date: tx.date as string,
      amount: absAmount,
      dayWindow: 7,
      max: 5
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Gmail search failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Replace cache
  await sb.from("transaction_receipts").delete().eq("transaction_id", transaction_id);
  if (matches.length > 0) {
    await sb.from("transaction_receipts").insert(
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
        amount_brl: absAmount
      }))
    );
  }

  // Mark transaction as searched
  await sb
    .from("transactions")
    .update({
      gmail_searched_at: new Date().toISOString(),
      gmail_match_count: matches.length
    })
    .eq("id", transaction_id);

  return NextResponse.json({ cached: false, matches });
}
