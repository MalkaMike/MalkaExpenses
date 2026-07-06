import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { preloadClusters } from "@/lib/merchants/clusters";
import { searchOneTransaction } from "@/lib/gmail/search-one";
import { verifyCronSecret } from "@/lib/auth/cron";

export const runtime = "nodejs";
export const maxDuration = 300; // Pro plan allows 300s

// GET /api/cron/gmail-search
//
// Vercel cron — runs daily at 06:30 UTC (03:30 BRT) after the 06:00 Pluggy
// sync (see vercel.json). Two passes:
//   Pass 1 — search transactions never searched before (gmail_searched_at IS NULL).
//   Pass 2 — retry rows whose previous search ERRORED (transient Gmail failure),
//            at most once per day, capped at 3 total attempts. Genuine 0-match
//            rows (gmail_search_error IS NULL) are never re-searched.
//
// Excludes fake transactions and only searches expenses (real_amount < 0,
// not transfers). Self-throttling: bails after ~250s to stay under the 300s
// timeout; unfinished work is picked up the next day.
export async function GET(req: NextRequest) {
  // Fail CLOSED: require CRON_SECRET to be set AND match (constant-time).
  if (!verifyCronSecret(req)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ skipped: true, reason: "Gmail not connected" });
  }

  const sb = serverClient();
  await preloadClusters();

  const startedAt = Date.now();
  const HARD_DEADLINE_MS = 250_000; // 250s — Vercel kills at 300s
  const timeLeft = () => Date.now() - startedAt < HARD_DEADLINE_MS;

  // Start of today (UTC) — Pass 2 only retries rows last touched on a PRIOR day,
  // so a persistently-failing row is retried at most once per cron run.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  let processed = 0;
  let found = 0;
  const errors: string[] = [];
  // Livelock guard: if a row's stamp write fails, it keeps matching the
  // IS NULL / retry filters — without this the loop refetches the same 10
  // rows for the whole 250s budget, hammering the Gmail API.
  const seen = new Set<string>();

  // ── Pass 1: never-searched transactions ───────────────────────────────────
  while (timeLeft()) {
    const { data: txs, error: qErr } = await sb
      .from("transactions")
      .select("id, date, description_raw, real_amount, gmail_search_attempts")
      .is("gmail_searched_at", null)
      .eq("is_fake", false)
      .eq("is_transfer", false)
      .lt("real_amount", 0)
      .order("date", { ascending: false })
      .limit(10); // v2 is slower — smaller batches

    if (qErr) {
      errors.push(`pass1 query failed: ${qErr.message}`);
      break;
    }
    const fresh = (txs ?? []).filter((t) => !seen.has(t.id));
    if (fresh.length === 0) break;

    for (const tx of fresh) {
      if (!timeLeft()) break;
      seen.add(tx.id);
      processed++;
      const r = await searchOneTransaction(sb, cred.accessToken, tx);
      if (r.found) found++;
    }
  }

  // ── Pass 2: bounded retry of rows that ERRORED on a previous day ───────────
  // Genuine 0-match rows (gmail_search_error IS NULL) are never picked here.
  let retried = 0;
  let retryFound = 0;
  while (timeLeft()) {
    const { data: txs, error: qErr } = await sb
      .from("transactions")
      .select("id, date, description_raw, real_amount, gmail_search_attempts")
      .not("gmail_search_error", "is", null)
      .lt("gmail_search_attempts", 3)
      .lt("gmail_searched_at", todayStartIso)
      .eq("is_fake", false)
      .eq("is_transfer", false)
      .lt("real_amount", 0)
      .order("gmail_search_attempts", { ascending: true })
      .limit(10);

    if (qErr) {
      errors.push(`pass2 query failed: ${qErr.message}`);
      break;
    }
    const fresh = (txs ?? []).filter((t) => !seen.has(t.id));
    if (fresh.length === 0) break;

    for (const tx of fresh) {
      if (!timeLeft()) break;
      seen.add(tx.id);
      retried++;
      const r = await searchOneTransaction(sb, cred.accessToken, tx);
      if (r.found) retryFound++;
    }
  }

  return NextResponse.json({
    processed,
    found,
    retried,
    retryFound,
    elapsedMs: Date.now() - startedAt,
    hitDeadline: !timeLeft(),
    ...(errors.length > 0 ? { errors } : {})
  });
}
