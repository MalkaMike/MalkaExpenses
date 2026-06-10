import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { runReconcileScan } from "@/lib/reconciliation/run";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Auto-scan body: optional accountId scopes the scan to one bank account.
const Body = z.object({ accountId: z.string().uuid().optional() });

// ── POST /api/reconcile ───────────────────────────────────────────────────────
// Description-based double-count protection: scans bank "PAG FATURA" outflows
// and marks them as transfers (cartao_pagamento) so a CC payment isn't counted
// alongside the itemized card transactions Pluggy already delivers.
//   • { accountId? } → auto-scan + auto-mark
export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const result = await runReconcileScan(serverClient(), parsed.data.accountId);
  return NextResponse.json(result);
}
