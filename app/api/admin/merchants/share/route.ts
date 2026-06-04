import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

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
//          (household sees the same value as admin)
// "hide" → shared_amount = 0 for every tx of the cluster
//          (the security view filters shared_amount=0 → wife sees nothing)
// "set"  → shared_amount = value for every tx (custom per-merchant amount)
//
// Atomic: one Postgres function call, no partial state.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { canonical_key, mode, value } = parsed.data;

  if (mode === "set" && value === undefined) {
    return NextResponse.json({ error: "value required for set mode" }, { status: 400 });
  }

  const sb = serverClient();

  const { data: updated, error: rpcErr } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: mode,
    p_value: value ?? null
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

  await writeAudit("merchant.bulk_share", {
    newValue: { canonical_key, mode, value, updated: updatedCount }
  });

  return NextResponse.json({ ok: true, updated: updatedCount });
}
