import "server-only";
import type { serverClient } from "@/lib/supabase/server";
import { findReceiptsForTransactionV2 } from "@/lib/gmail/find-receipt-v2";
import { clusterFor } from "@/lib/merchants/clusters";

type SB = ReturnType<typeof serverClient>;

export type SearchOneResult = {
  found: boolean;
  matchCount: number;
  errored: boolean;
};

export type SearchableTx = {
  id: string;
  date: string;
  description_raw: string;
  real_amount: number;
  gmail_search_attempts?: number | null;
};

// ============================================================================
// searchOneTransaction — the SINGLE source of truth for "search Gmail for one
// transaction's nota fiscal and persist the outcome".
//
// Used by both the daily cron and the manual batch button so the idempotency,
// dedup and retry bookkeeping can never drift between them.
//
// Guarantees:
//   • Receipts are saved with an idempotent upsert keyed on
//     (transaction_id, gmail_message_id) → a re-run can NEVER duplicate a row.
//   • gmail_searched_at + gmail_match_count are ALWAYS set, so a genuine
//     0-match is cached and never re-searched by the normal IS NULL selection.
//   • On success gmail_search_error is cleared; on failure it records the error
//     so a bounded retry pass can re-try ONLY the rows that errored.
//   • gmail_search_attempts is bumped by 1 each call (retry cap lives in the
//     caller's selection filter).
//   • Never throws — caller loops stay alive.
//
// The caller MUST have run preloadClusters() already.
// ============================================================================
export async function searchOneTransaction(
  sb: SB,
  accessToken: string,
  tx: SearchableTx
): Promise<SearchOneResult> {
  const absAmount = Math.abs(Number(tx.real_amount));
  const attempts = Number(tx.gmail_search_attempts ?? 0) + 1;
  const nowIso = new Date().toISOString();

  try {
    const cluster = clusterFor(tx.description_raw);
    const matches = await findReceiptsForTransactionV2({
      accessToken,
      merchantName: cluster.name,
      date: tx.date,
      amount: absAmount,
      dayWindow: 7,
      max: 5
    });

    if (matches.length > 0) {
      await sb.from("transaction_receipts").upsert(
        matches.map((m) => ({
          transaction_id: tx.id,
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
        gmail_searched_at: nowIso,
        gmail_match_count: matches.length,
        gmail_search_error: null,
        gmail_search_attempts: attempts
      })
      .eq("id", tx.id);

    return { found: matches.length > 0, matchCount: matches.length, errored: false };
  } catch (e) {
    // Record the error (don't loop): the row is marked searched so the normal
    // IS NULL pass skips it, but gmail_search_error lets the retry pass find it.
    await sb
      .from("transactions")
      .update({
        gmail_searched_at: nowIso,
        gmail_match_count: 0,
        gmail_search_error: (e as Error).message?.slice(0, 300) ?? "unknown",
        gmail_search_attempts: attempts
      })
      .eq("id", tx.id);

    return { found: false, matchCount: 0, errored: true };
  }
}
