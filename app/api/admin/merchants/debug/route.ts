import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/merchants/debug?key=manus_ai
// Temporary diagnostic: shows merchant_clusters rows for the given key
export async function GET(req: NextRequest) {
  await requireAdmin();
  const key = req.nextUrl.searchParams.get("key") ?? "manus_ai";
  const sb = serverClient();

  const { data: byKey, error: e1 } = await sb
    .from("merchant_clusters")
    .select("id, description_raw, canonical_key, is_reviewed, is_deferred, updated_at")
    .eq("canonical_key", key);

  const { data: byDesc, error: e2 } = await sb
    .from("merchant_clusters")
    .select("id, description_raw, canonical_key, is_reviewed, is_deferred, updated_at")
    .ilike("description_raw", `%${key.replace(/_/g, " ")}%`);

  return NextResponse.json({
    byKey: { rows: byKey ?? [], error: e1?.message, count: byKey?.length ?? 0 },
    byDescLike: { rows: byDesc ?? [], error: e2?.message, count: byDesc?.length ?? 0 },
  });
}
