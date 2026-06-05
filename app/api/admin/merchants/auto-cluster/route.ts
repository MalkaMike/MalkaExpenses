import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { preloadClusters, findFuzzyCluster } from "@/lib/merchants/clusters";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/auto-cluster
//
// Scans all transactions whose description_raw is NOT in merchant_clusters
// and tries to fuzzy-match them to an existing cluster. Any match above
// the 0.5 Jaccard threshold is persisted as a new row in merchant_clusters,
// so the description is permanently grouped with the matched merchant.
//
// Returns: { added: number, descriptions: string[] }
// Safe to re-run: ON CONFLICT(description_raw) DO NOTHING.
export async function POST(_req: NextRequest) {
  await requireAdmin();

  const sb = serverClient();
  await preloadClusters();

  // Find descriptions that have NO entry in merchant_clusters
  const all: string[] = [];
  let off = 0;
  while (true) {
    const { data } = await sb
      .from("transactions")
      .select("description_raw")
      .range(off, off + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      const d = r.description_raw as string;
      if (d && !all.includes(d)) all.push(d);
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  const { data: known } = await sb
    .from("merchant_clusters")
    .select("description_raw");
  const knownSet = new Set((known ?? []).map((r) => r.description_raw as string));

  const unclustered = all.filter((d) => !knownSet.has(d));

  // Fuzzy-match each unclustered description
  const toInsert: Array<{ description_raw: string; canonical_key: string; canonical_name: string }> = [];
  for (const desc of unclustered) {
    const match = findFuzzyCluster(desc);
    if (match) {
      toInsert.push({
        description_raw: desc,
        canonical_key: match.key,
        canonical_name: match.name
      });
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ added: 0, descriptions: [] });
  }

  // Insert in batches of 200 — ON CONFLICT DO NOTHING
  let added = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const slice = toInsert.slice(i, i + 200);
    const { error } = await sb
      .from("merchant_clusters")
      .upsert(slice, { onConflict: "description_raw", ignoreDuplicates: true });
    if (!error) added += slice.length;
  }

  return NextResponse.json({
    added,
    descriptions: toInsert.map((r) => r.description_raw)
  });
}
