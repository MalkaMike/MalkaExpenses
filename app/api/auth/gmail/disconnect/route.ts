import { NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { disconnect } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

// POST /api/auth/gmail/disconnect
// Admin-only. Marks the Gmail credential as revoked. Cached receipt rows
// stay in transaction_receipts (admin may reconnect later).
export async function POST() {
  await requireAdmin();
  await disconnect();
  await writeAudit("gmail.disconnect");
  return NextResponse.json({ ok: true });
}
