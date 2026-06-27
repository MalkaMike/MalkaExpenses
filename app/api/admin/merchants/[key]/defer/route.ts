import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { ensureClusterRowsExist } from "@/lib/merchants/ensure-cluster";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/[key]/defer
// Marks a merchant cluster as deferred ("verificar depois").
// No visibility change — shared_amount is untouched.
// Merchant stays unreviewed; disappears from the active "Para revisar" queue.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAdmin();
  const { key: canonical_key } = await params;
  const sb = serverClient();

  // Ensure rows exist (creates them from transactions for slug-fallback merchants)
  const found = await ensureClusterRowsExist(canonical_key, sb);
  if (!found) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  const { error } = await sb
    .from("merchant_clusters")
    .update({ is_deferred: true })
    .eq("canonical_key", canonical_key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit("merchant.defer", { newValue: { canonical_key } });

  return NextResponse.json({ ok: true });
}
