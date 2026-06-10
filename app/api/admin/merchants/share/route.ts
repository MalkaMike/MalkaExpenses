import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";
import { toDb } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  canonical_key: z.string().min(1).max(60),
  mode: z.enum(["show", "hide", "set"]),
  value: z.number().optional()
});

// POST /api/admin/merchants/share
// Body: { canonical_key, mode: "show"|"hide"|"set", value?: number }
//
// "show" → shared_amount = real_amount for every tx of the cluster
// "hide" → shared_amount = 0 for every tx of the cluster
// "set"  → shared_amount = value for every tx
//
// Atomic via Postgres RPC: the bulk UPDATE + admin_modifications INSERT
// both commit or both roll back (0030_transactional_rpcs.sql).
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { canonical_key, mode, value } = parsed.data;
  if (mode === "set" && value === undefined) {
    return NextResponse.json({ error: "value required for set mode" }, { status: 400 });
  }

  const sb = serverClient();

  // Resolve the merchant's display name for the audit row
  const { data: cluster } = await sb
    .from("merchant_clusters")
    .select("canonical_name")
    .eq("canonical_key", canonical_key)
    .limit(1)
    .maybeSingle();
  const merchantName = cluster?.canonical_name ?? canonical_key;

  // Single RPC: bulk UPDATE + admin_modifications INSERT — atomic.
  // The function reads its own before-state, applies the update, computes
  // impact, and writes the audit row — all in one Postgres transaction.
  const { data: rpcResult, error: rpcErr } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: mode,
    p_value: value !== undefined ? toDb(value) : null,
    p_merchant_name: merchantName
  });

  if (rpcErr) {
    return NextResponse.json(
      { error: `bulk share update failed: ${rpcErr.message}` },
      { status: 500 }
    );
  }

  const result = rpcResult as { updated: number; impact_brl: number };
  const updatedCount = result.updated ?? 0;
  const impact = result.impact_brl ?? 0;

  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found or empty" }, { status: 404 });
  }

  // Keep the generic audit_log too (security trail)
  await writeAudit("merchant.bulk_share", {
    newValue: { canonical_key, mode, value, updated: updatedCount, impact }
  });

  return NextResponse.json({ ok: true, updated: updatedCount, impact });
}
