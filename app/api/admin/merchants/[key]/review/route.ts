import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { ensureClusterRowsExist } from "@/lib/merchants/ensure-cluster";

export const runtime = "nodejs";

// POST /api/admin/merchants/[key]/review
// Toggles is_reviewed on the merchant cluster. Returns { reviewed: boolean }.
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

  // Read current state (any row for this canonical_key)
  const { data: row } = await sb
    .from("merchant_clusters")
    .select("is_reviewed")
    .eq("canonical_key", canonical_key)
    .limit(1)
    .maybeSingle();

  const newState = !(row?.is_reviewed ?? false);

  const { error } = await sb
    .from("merchant_clusters")
    .update({ is_reviewed: newState })
    .eq("canonical_key", canonical_key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reviewed: newState });
}
