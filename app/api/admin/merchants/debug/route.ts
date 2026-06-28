import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { fromDb } from "@/lib/money";

export const runtime = "nodejs";

// GET /api/admin/merchants/debug?key=manus_ai
// Diagnostic: shows merchant_clusters rows + simulates the page.tsx group-building for a key
export async function GET(req: NextRequest) {
  await requireAdmin();
  const key = req.nextUrl.searchParams.get("key") ?? "manus_ai";
  const sb = serverClient();

  // 1. Raw DB rows for this key
  const { data: byKey } = await sb
    .from("merchant_clusters")
    .select("id, description_raw, canonical_key, is_reviewed, is_deferred, updated_at")
    .eq("canonical_key", key);

  // 2. Simulate page.tsx: reload clusters, scan transactions, find group
  invalidateCache();
  await preloadClusters();

  const matchingTxDescs: { description_raw: string; clusterKey: string; shared_amount: number; real_amount: number }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("transactions")
      .select("description_raw, shared_amount, real_amount")
      .eq("is_fake", false)
      .range(off, off + 999);
    if (error || !data?.length) break;
    for (const t of data as { description_raw: string; shared_amount: number; real_amount: number }[]) {
      const c = clusterFor(t.description_raw);
      if (c.key === key) {
        matchingTxDescs.push({ description_raw: t.description_raw, clusterKey: c.key, shared_amount: Number(t.shared_amount), real_amount: Number(t.real_amount) });
      }
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  // 3. What does the is_reviewed query return for this key?
  const { data: isRevRows } = await sb
    .from("merchant_clusters")
    .select("canonical_key, is_reviewed, is_deferred")
    .in("canonical_key", [key])
    .limit(10000);

  const anyReviewed = (isRevRows ?? []).some((r: { is_reviewed: boolean }) => r.is_reviewed);

  // 4. hiddenCount vs txCount
  const txCount = matchingTxDescs.length;
  const hiddenCount = matchingTxDescs.filter(t => fromDb(t.shared_amount) === 0).length;

  return NextResponse.json({
    key,
    dbRows: { rows: byKey ?? [], count: byKey?.length ?? 0 },
    simulation: {
      txCount,
      hiddenCount,
      anyReviewed,
      isRevRows: isRevRows ?? [],
      tab: anyReviewed
        ? (hiddenCount === txCount && txCount > 0 ? "Ocultos de Ayelet" : "Visíveis para Ayelet")
        : "Para revisar",
      sampleTxDescs: matchingTxDescs.slice(0, 20),
    },
  });
}
