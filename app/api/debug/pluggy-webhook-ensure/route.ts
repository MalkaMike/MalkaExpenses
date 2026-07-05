import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { listWebhooks, createWebhook, updateWebhook } from "@/lib/pluggy/client";

export const runtime = "nodejs";

// GET /api/debug/pluggy-webhook-ensure — admin-gated, idempotent.
// Turned out there was NO webhook registered on the Pluggy application at all
// (confirmed via /api/debug/pluggy-webhooks returning an empty list) — so the
// original ?token= security concern was moot in practice, but real-time sync
// was silently not happening either (only the daily /api/cron/pluggy-sync was
// running). This creates the webhook fresh with the secret in a header from
// the start (Pluggy's dashboard can't do that — API-only), or repairs it if
// one already exists with the old url-token shape. DELETE after confirming.
export async function GET() {
  await requireAdmin();

  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "PLUGGY_WEBHOOK_SECRET not set" }, { status: 500 });
  }
  const targetUrl = "https://malkafinance.vercel.app/api/pluggy/webhook";

  const webhooks = await listWebhooks();
  const existing = webhooks.find((w) => w.url.includes("/api/pluggy/webhook"));

  if (!existing) {
    const created = await createWebhook(targetUrl, "all", { "X-Webhook-Secret": secret });
    return NextResponse.json({ ok: true, action: "created", id: created.id, url: created.url });
  }

  const updated = await updateWebhook(existing.id, {
    url: existing.url.split("?")[0],
    headers: { "X-Webhook-Secret": secret }
  });
  return NextResponse.json({ ok: true, action: "updated", id: updated.id, url: updated.url });
}
