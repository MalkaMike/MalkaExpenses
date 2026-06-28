import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters, invalidateCache } from "@/lib/merchants/clusters";

export const runtime = "nodejs";

// GET /api/debug/merchant-cluster?key=manus_ai
// Returns DB rows and clusterFor result for debugging.
// DELETE THIS ENDPOINT after debugging is done.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const key = new URL(req.url).searchParams.get("key") ?? "manus_ai";
  const sb = serverClient();

  // Rows by canonical_key
  const { data: byKey, error: e1 } = await sb
    .from("merchant_clusters")
    .select("id, description_raw, canonical_key, canonical_name, is_reviewed, is_deferred")
    .eq("canonical_key", key);

  // Page SELECT simulation: exact same query as page.tsx
  const { data: pageSelect, error: e2 } = await sb
    .from("merchant_clusters")
    .select("canonical_key, is_reviewed, is_deferred")
    .in("canonical_key", [key]);

  // clusterFor result for the descriptions
  invalidateCache();
  await preloadClusters();
  const clusterResults: Record<string, unknown> = {};
  for (const row of (byKey ?? [])) {
    clusterResults[row.description_raw as string] = clusterFor(row.description_raw as string);
  }

  // Also check what clusterFor returns for the key's name
  clusterResults["_direct_key_lookup"] = clusterFor(key);

  return NextResponse.json({
    key,
    byKey,
    byKeyError: e1?.message ?? null,
    pageSelect,
    pageSelectError: e2?.message ?? null,
    clusterResults,
  });
}
