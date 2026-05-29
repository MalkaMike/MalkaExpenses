import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem } from "@/lib/pluggy/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/pluggy/webhook?token=SECRET
// Pluggy calls this when an item updates (new transactions, MFA refresh, etc.).
// Guarded by a shared secret in the query string (set PLUGGY_WEBHOOK_SECRET and
// configure the same token on the Pluggy dashboard webhook URL). Returns 404
// when the secret is missing/wrong — no signal the endpoint exists.
export async function POST(req: NextRequest) {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  const token = req.nextUrl.searchParams.get("token");
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    itemId?: string;
  } | null;

  if (!body?.itemId) {
    // Acknowledge non-actionable events so Pluggy doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  // Only resync on events that can change transaction data.
  const actionable =
    !body.event ||
    body.event.startsWith("item/") ||
    body.event.startsWith("transactions/");
  if (!actionable) {
    return NextResponse.json({ ok: true });
  }

  try {
    const sb = serverClient();
    const result = await syncPluggyItem(sb, body.itemId);
    return NextResponse.json({ ok: true, inserted: result.inserted });
  } catch (e) {
    console.error("[pluggy webhook]", e);
    // 200 so Pluggy doesn't hammer retries; the error is logged for us.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
