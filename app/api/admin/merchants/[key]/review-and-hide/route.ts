import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { ensureClusterRowsExist } from "@/lib/merchants/ensure-cluster";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/[key]/review-and-hide
// Marks the merchant cluster as reviewed AND hides all its transactions from
// Ayelet/Celine (shared_amount = 0). One-tap action from the merchant list.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAdmin();
  const { key: canonical_key } = await params;
  const sb = serverClient();

  const found = await ensureClusterRowsExist(canonical_key, sb);
  if (!found) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  const { error: revErr } = await sb
    .from("merchant_clusters")
    .update({ is_reviewed: true })
    .eq("canonical_key", canonical_key);
  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });

  const { data: updated, error: hideErr } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: "hide",
    p_value: null
  });
  if (hideErr) return NextResponse.json({ error: hideErr.message }, { status: 500 });

  await writeAudit("merchant.review-and-hide", {
    newValue: { canonical_key, updated: Number(updated ?? 0) }
  });

  return NextResponse.json({ ok: true, updated: Number(updated ?? 0) });
}
