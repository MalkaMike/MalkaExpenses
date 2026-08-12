import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem } from "@/lib/pluggy/sync";
import { verifyCronSecret } from "@/lib/auth/cron";
import { checkIngestFreshness, freshnessAlertHtml } from "@/lib/pluggy/freshness";
import { sendEmail } from "@/lib/gmail/send";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/cron/pluggy-sync — daily auto-sync of every connected Pluggy bank.
// Triggered by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set; we require it
// so the endpoint can't be hit by anyone. Returns 404 when unauthorized.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sb = serverClient();

  // Collect distinct connected items. If the pluggy column doesn't exist yet
  // (migration not applied), this returns empty and we no-op cleanly.
  const { data } = await sb
    .from("accounts")
    .select("pluggy_item_id")
    .not("pluggy_item_id", "is", null);
  const itemIds = Array.from(
    new Set((data ?? []).map((r) => r.pluggy_item_id as string).filter(Boolean))
  );

  if (itemIds.length === 0) {
    return NextResponse.json({ ok: true, items: 0, inserted: 0 });
  }

  let inserted = 0;
  // syncPluggyItem collects non-fatal failures in `errors` instead of throwing.
  // This used to be discarded here, so a sync could fail every account and still
  // report ok:true — the error channel existed and nothing ever read it.
  const errors: string[] = [];
  for (const id of itemIds) {
    try {
      const r = await syncPluggyItem(sb, id);
      inserted += r.inserted;
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`item ${id} threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) console.error("[cron pluggy-sync] errors", errors);

  // Liveness check. `inserted: 0` is normal on a quiet day, so a single run
  // proves nothing — only the age of the newest ingested row does.
  const freshness = await checkIngestFreshness(sb);
  if (freshness.isStale) {
    console.error("[cron pluggy-sync] INGESTION STALE", freshness);
    if (env.ALERT_EMAIL) {
      try {
        await sendEmail({
          to: env.ALERT_EMAIL,
          subject: `[Casa] Sem transações novas há ${freshness.daysStale ?? "?"} dias`,
          body_html: freshnessAlertHtml(freshness, errors)
        });
      } catch (e) {
        // The alarm failing must not take the sync down with it, but it must
        // not vanish either — a silent alarm is worse than none.
        console.error("[cron pluggy-sync] freshness alert failed to send", e);
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    items: itemIds.length,
    inserted,
    errors,
    freshness
  });
}
