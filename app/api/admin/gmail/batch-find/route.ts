import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { findReceiptsForTransaction } from "@/lib/gmail/search";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  /** Max transactions to process this call. Keep small to fit in maxDuration. */
  limit: z.number().int().min(1).max(50).optional()
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
  const limit = parsed.data.limit ?? 30;

  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  const sb = serverClient();
  await preloadClusters();

  // Pull the next chunk of unsearched transactions.
  // Order by date DESC so the most recent (most likely to have receipts) get
  // processed first — better UX for the admin scrolling recent activity.
  const { data: txs } = await sb
    .from("transactions")
    .select("id, date, description_raw, real_amount, is_transfer")
    .is("gmail_searched_at", null)
    // Skip transfers — CC payments, PIX between own accounts don't have receipts
    .eq("is_transfer", false)
    // Skip income (receipts only matter for expenses)
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
    try {
      const cluster = clusterFor(tx.description_raw as string);
      const matches = await findReceiptsForTransaction({
        accessToken: cred.accessToken,
        merchantName: cluster.name,
        date: tx.date as string,
        dayWindow: 3,
        max: 5
      });

      // Persist matches (if any)
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
            match_score: m.matchScore,
            match_reason: m.matchReason
          })),
          { onConflict: "transaction_id,gmail_message_id" }
        );
      }

      // Mark as searched regardless of result
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
