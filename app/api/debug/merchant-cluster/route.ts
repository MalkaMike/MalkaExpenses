import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters, invalidateCache } from "@/lib/merchants/clusters";
import { fromDb } from "@/lib/money";

export const runtime = "nodejs";

// GET /api/debug/merchant-cluster?key=manus_ai
// Simulates page.tsx logic and shows exactly why a merchant is/isn't in todoGroups.
// DELETE THIS ENDPOINT after debugging is done.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const targetKey = new URL(req.url).searchParams.get("key") ?? "manus_ai";
  const sb = serverClient();

  // Step 1: rows by canonical_key
  const { data: byKey, error: e1 } = await sb
    .from("merchant_clusters")
    .select("id, description_raw, canonical_key, canonical_name, is_reviewed, is_deferred")
    .eq("canonical_key", targetKey);

  // Step 2: simulate preloadClusters + build groups like page.tsx does
  invalidateCache();
  await preloadClusters();

  // Load transactions (only a sample to avoid timeout)
  const { data: txSample } = await sb
    .from("transactions")
    .select("id, description_raw, real_amount, shared_amount")
    .eq("is_fake", false)
    .order("id", { ascending: true })
    .limit(5000);

  const groups = new Map<string, { key: string; txCount: number; hiddenCount: number; isReviewed: boolean; isDeferred: boolean; descriptions: string[] }>();

  for (const t of (txSample ?? [])) {
    const amt = fromDb(Number(t.real_amount));
    if (amt >= 0) continue; // only expenses (direction=out)
    const c = clusterFor(t.description_raw as string);
    if (!groups.has(c.key)) {
      groups.set(c.key, { key: c.key, txCount: 0, hiddenCount: 0, isReviewed: false, isDeferred: false, descriptions: [] });
    }
    const g = groups.get(c.key)!;
    g.txCount++;
    const sharedAmt = fromDb(Number(t.shared_amount));
    if (sharedAmt === 0) g.hiddenCount++;
    if (!g.descriptions.includes(t.description_raw as string)) g.descriptions.push(t.description_raw as string);
  }

  const allGroupKeys = [...groups.keys()];
  const targetGroupBefore = groups.get(targetKey);

  // Step 3: simulate the is_reviewed SELECT (same chunked logic as page.tsx)
  const KEY_CHUNK = 500;
  const selectResults: unknown[] = [];
  const selectErrors: string[] = [];
  for (let i = 0; i < allGroupKeys.length; i += KEY_CHUNK) {
    const { data: rv, error: re } = await sb
      .from("merchant_clusters")
      .select("canonical_key, is_reviewed, is_deferred")
      .in("canonical_key", allGroupKeys.slice(i, i + KEY_CHUNK));
    if (re) selectErrors.push(`chunk ${i}: ${re.message}`);
    for (const r of (rv ?? []) as { canonical_key: string; is_reviewed: boolean; is_deferred: boolean }[]) {
      if (r.canonical_key === targetKey) selectResults.push(r);
      const g = groups.get(r.canonical_key);
      if (g) {
        g.isReviewed = r.is_reviewed ?? false;
        g.isDeferred = r.is_deferred ?? false;
      }
    }
  }

  const targetGroupAfter = groups.get(targetKey);
  const totalGroups = groups.size;
  const todoGroups = [...groups.values()].filter(g => !g.isReviewed && !g.isDeferred);
  const targetInTodo = todoGroups.some(g => g.key === targetKey);

  return NextResponse.json({
    targetKey,
    dbRows: byKey,
    dbRowsError: e1?.message ?? null,
    targetGroupBefore,
    selectResultsForTarget: selectResults,
    selectErrors,
    targetGroupAfter,
    totalGroups,
    todoCount: todoGroups.length,
    targetInTodo,
    note: "txSample limited to 5000 rows — counts may differ from full page"
  });
}
