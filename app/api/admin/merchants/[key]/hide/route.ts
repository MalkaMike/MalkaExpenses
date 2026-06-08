import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/[key]/hide
// Sets shared_amount = 0 for all transactions of this merchant cluster.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAdmin();
  const { key: canonical_key } = await params;

  const sb = serverClient();

  const { data: updated, error } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: "hide",
    p_value: null
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const updatedCount = Number(updated ?? 0);
  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found or empty" }, { status: 404 });
  }

  await writeAudit("merchant.hide", { newValue: { canonical_key, updated: updatedCount } });

  return NextResponse.json({ ok: true, updated: updatedCount });
}
