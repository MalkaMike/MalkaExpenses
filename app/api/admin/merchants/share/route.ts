import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";
import { toDb, fromDb } from "@/lib/money";

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
// Atomic via Postgres RPC. ALSO logs to admin_modifications with full
// before/after detail so /admin/historico can render + revert.
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

  // (a) Snapshot the cluster BEFORE the bulk write — needed for the
  // modification log so /admin/historico can show old vs new per row.
  const { data: cluster } = await sb
    .from("merchant_clusters")
    .select("canonical_name")
    .eq("canonical_key", canonical_key)
    .limit(1)
    .maybeSingle();
  const merchantName = cluster?.canonical_name ?? canonical_key;

  // Get description_raws first, then load matching transactions with current shared/real
  const { data: rawDescs } = await sb
    .from("merchant_clusters")
    .select("description_raw")
    .eq("canonical_key", canonical_key);
  const descList = (rawDescs ?? []).map((r) => r.description_raw as string);

  type TxBefore = { id: string; shared_amount: number; real_amount: number };
  const beforeRows: TxBefore[] = [];
  if (descList.length > 0) {
    for (let i = 0; i < descList.length; i += 200) {
      const slice = descList.slice(i, i + 200);
      const { data } = await sb
        .from("transactions")
        .select("id, shared_amount, real_amount")
        .in("description_raw", slice);
      if (data) beforeRows.push(...(data as TxBefore[]));
    }
  }

  // (b) Apply the RPC
  const { data: updated, error: rpcErr } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: mode,
    p_value: value !== undefined ? toDb(value) : null
  });

  if (rpcErr) {
    return NextResponse.json(
      { error: `bulk share update failed: ${rpcErr.message}` },
      { status: 500 }
    );
  }
  const updatedCount = Number(updated ?? 0);
  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found or empty" }, { status: 404 });
  }

  // (c) Compute aggregate impact for the modification log (in BRL)
  const totalBefore = beforeRows.reduce((s, r) => s + fromDb(Number(r.shared_amount)), 0);
  const totalAfter =
    mode === "hide"
      ? 0
      : mode === "show"
        ? beforeRows.reduce((s, r) => s + fromDb(Number(r.real_amount)), 0)
        : (value ?? 0) * beforeRows.length;
  const impact = Number((totalAfter - totalBefore).toFixed(2));

  await sb.from("admin_modifications").insert({
    action: mode === "set" ? "adjust" : mode, // 'hide' | 'show' | 'adjust'
    scope: "merchant",
    target_id: canonical_key,
    target_name: merchantName,
    field: "shared_amount",
    before_value: { total: totalBefore, rows: beforeRows.length },
    after_value:
      mode === "set"
        ? { total: totalAfter, per_row_value: value, rows: beforeRows.length }
        : { total: totalAfter, rows: beforeRows.length },
    affected_count: updatedCount,
    impact_brl: impact,
    affected_ids: beforeRows.map((r) => r.id)
  });

  // Keep the generic audit_log too (security trail)
  await writeAudit("merchant.bulk_share", {
    newValue: { canonical_key, mode, value, updated: updatedCount, impact }
  });

  return NextResponse.json({ ok: true, updated: updatedCount, impact });
}
