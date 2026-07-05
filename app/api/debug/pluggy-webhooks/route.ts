import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { listWebhooks } from "@/lib/pluggy/client";

export const runtime = "nodejs";

// GET /api/debug/pluggy-webhooks — read-only, admin-gated.
// Lists webhooks currently registered on the Pluggy application so we can
// confirm the one-time migration (moving the shared secret from ?token= in
// the url into a custom header) actually took effect. DELETE after confirming.
export async function GET() {
  await requireAdmin();
  const webhooks = await listWebhooks();
  return NextResponse.json({ webhooks });
}
