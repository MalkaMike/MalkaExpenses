import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem } from "@/lib/pluggy/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/pluggy/webhook?token=SECRET
// Pluggy calls this on item/transaction changes. Per Pluggy's contract we MUST
// return 2XX within 5 seconds — so we acknowledge immediately and run the heavy
// sync (fetch accounts + transactions + AI categorization, easily >5s) AFTER the
// response via Next's after(), which keeps the work alive on Vercel.
//
// Guarded by a shared secret in the query string (PLUGGY_WEBHOOK_SECRET, set on
// both Vercel and the Pluggy dashboard webhook URL). Returns 404 when missing/
// wrong — no signal the endpoint exists. Credentials (PLUGGY_CLIENT_ID/SECRET)
// live only in env; this handler never touches them directly.
export async function POST(req: NextRequest) {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  const token = req.nextUrl.searchParams.get("token");
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    eventId?: string;
    itemId?: string;
    error?: unknown;
  } | null;

  // Lightweight, fast log (no heavy work before responding).
  console.log("[pluggy webhook]", body?.event ?? "(no event)", body?.eventId ?? "");

  const itemId = body?.itemId;
  const event = body?.event ?? "";
  const actionable =
    !!itemId &&
    (event === "" || event.startsWith("item/") || event.startsWith("transactions/"));

  if (event === "item/error") {
    // Nothing to sync on an errored item; surface it for us.
    console.error("[pluggy webhook] item/error", itemId, body?.error);
  } else if (actionable) {
    // Heavy work AFTER the response — keeps us under Pluggy's 5s limit.
    after(async () => {
      try {
        const sb = serverClient();
        const result = await syncPluggyItem(sb, itemId);
        console.log("[pluggy webhook] synced", itemId, "inserted", result.inserted);
      } catch (e) {
        console.error("[pluggy webhook] async sync failed", itemId, e);
      }
    });
  }

  // Always 2XX immediately so Pluggy doesn't retry/disable the webhook.
  return NextResponse.json({ received: true });
}
