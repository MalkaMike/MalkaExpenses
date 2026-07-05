import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/auth/cron";
import { listWebhooks, updateWebhook } from "@/lib/pluggy/client";

export const runtime = "nodejs";

// GET /api/cron/pluggy-webhook-migrate — ONE-TIME migration, not a recurring job.
// Pluggy's dashboard can only register a bare webhook url, so the shared secret
// had to ride in a `?token=` query string (gets written to access logs in
// plaintext). This moves it into a custom header, which Pluggy's dashboard
// can't set — only their API can, so this runs once via a Vercel Cron trigger
// (gets `Authorization: Bearer <CRON_SECRET>` from Vercel itself, same as the
// other /api/cron/* routes) and is deleted from vercel.json + the repo right
// after it confirms success.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "PLUGGY_WEBHOOK_SECRET not set" }, { status: 500 });
  }

  const webhooks = await listWebhooks();
  const target = webhooks.find((w) => w.url.includes("/api/pluggy/webhook"));
  if (!target) {
    // 409 (not 200) so the outcome is visible from the HTTP status alone in
    // Vercel's access-log line, even without console-log/runtime-log access.
    return NextResponse.json({ ok: false, error: "no matching webhook found", webhooks }, { status: 409 });
  }

  const cleanUrl = target.url.split("?")[0];
  const updated = await updateWebhook(target.id, {
    url: cleanUrl,
    headers: { "X-Webhook-Secret": secret }
  });

  console.log("[pluggy-webhook-migrate] updated", updated.id, "url now:", updated.url);
  return NextResponse.json({
    ok: true,
    id: updated.id,
    url: updated.url,
    hadQueryString: target.url.includes("?")
  });
}
