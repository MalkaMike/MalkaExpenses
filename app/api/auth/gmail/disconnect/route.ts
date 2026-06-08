import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { disconnect } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

// POST /api/auth/gmail/disconnect?role=admin|health
// Admin-only. Marks the credential for the given role as revoked.
// If ?role is omitted, disconnects all active credentials.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const role = new URL(req.url).searchParams.get("role") ?? undefined;
  await disconnect(role);
  await writeAudit("gmail.disconnect", { newValue: { role: role ?? "all" } });
  return NextResponse.json({ ok: true });
}
