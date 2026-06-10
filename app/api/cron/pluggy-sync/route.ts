import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem } from "@/lib/pluggy/sync";
import { verifyCronSecret } from "@/lib/auth/cron";

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
  for (const id of itemIds) {
    try {
      const r = await syncPluggyItem(sb, id);
      inserted += r.inserted;
    } catch (e) {
      console.error("[cron pluggy-sync] item failed", id, e);
    }
  }
  return NextResponse.json({ ok: true, items: itemIds.length, inserted });
}
