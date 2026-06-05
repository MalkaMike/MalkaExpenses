import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { findReceiptsForTransactionV2 } from "@/lib/gmail/find-receipt-v2";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";

export const runtime = "nodejs";
export const maxDuration = 300; // Pro plan allows 300s

// GET /api/cron/gmail-search
//
// Vercel cron — runs daily at 07:00 UTC (04:00 BRT) after the 06:00 Pluggy
// sync. Processes any transactions added since the last run by searching
// their Gmail for nota fiscal matches.
//
// Self-throttling: bails after ~250s to stay under Vercel's 300s timeout.
// Designed to be picked up next day if it doesn't finish.
export async function GET(req: NextRequest) {
  // Vercel cron sends a special header
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? "no-cron-secret-configured"}`) {
    // Still allow if no CRON_SECRET configured (dev mode)
    if (process.env.CRON_SECRET) {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }

  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ skipped: true, reason: "Gmail not connected" });
  }

  const sb = serverClient();
  await preloadClusters();

  const startedAt = Date.now();
  const HARD_DEADLINE_MS = 250_000; // 250s — Vercel kills at 300s

  let processed = 0;
  let found = 0;

  while (Date.now() - startedAt < HARD_DEADLINE_MS) {
    const { data: txs } = await sb
      .from("transactions")
      .select("id, date, description_raw, real_amount")
      .is("gmail_searched_at", null)
      .eq("is_transfer", false)
      .lt("real_amount", 0)
      .order("date", { ascending: false })
      .limit(10);  // v2 is slower — smaller batches

    if (!txs || txs.length === 0) break;

    for (const tx of txs) {
      if (Date.now() - startedAt >= HARD_DEADLINE_MS) break;
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
      } catch {
        await sb
          .from("transactions")
          .update({ gmail_searched_at: new Date().toISOString(), gmail_match_count: 0 })
          .eq("id", tx.id as string);
      }
    }
  }

  return NextResponse.json({
    processed,
    found,
    elapsedMs: Date.now() - startedAt,
    hitDeadline: Date.now() - startedAt >= HARD_DEADLINE_MS
  });
}
