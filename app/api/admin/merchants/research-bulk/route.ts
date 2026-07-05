import { NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { rawDescriptionsForKeyDirect, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { researchMerchant, type KnownProvider } from "@/lib/ai/merchant-research";
import { extractCnpj, lookupCnpj } from "@/lib/cnpj";

export const runtime = "nodejs";
export const maxDuration = 280;

const BATCH_SIZE = 15;
const CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// POST /api/admin/merchants/research-bulk
// Processes up to BATCH_SIZE not-yet-reviewed merchants per call. A merchant
// is pending when it has no merchant_research row OR its row predates the
// ficha format (what_does IS NULL) — so re-running the bulk button after the
// format upgrade re-researches everything into full fichas. Client calls
// repeatedly until `done: true`.
export async function POST() {
  await requireAdmin();
  const sb = serverClient();

  // Distinct canonical_keys still unreviewed (todo + deferred — everything
  // nobody has confirmed yet), paginated to beat PostgREST's 1000-row cap.
  const allKeys = new Set<string>();
  let off = 0;
  while (true) {
    const { data } = await sb
      .from("merchant_clusters")
      .select("canonical_key")
      .eq("is_reviewed", false)
      .range(off, off + 999);
    if (!data || !data.length) break;
    for (const r of data) allKeys.add(r.canonical_key as string);
    if (data.length < 1000) break;
    off += 1000;
  }

  // Keys already researched IN THE FICHA FORMAT — old-format rows
  // (what_does IS NULL) stay pending so they get upgraded.
  const alreadyDone = new Set<string>();
  off = 0;
  while (true) {
    const { data } = await sb
      .from("merchant_research")
      .select("canonical_key")
      .not("what_does", "is", null)
      .range(off, off + 999);
    if (!data || !data.length) break;
    for (const r of data) alreadyDone.add(r.canonical_key as string);
    if (data.length < 1000) break;
    off += 1000;
  }

  const pending = [...allKeys].filter((k) => !alreadyDone.has(k));
  const batch = pending.slice(0, BATCH_SIZE);

  await preloadClusters();

  // Category names by id — one fetch shared by the whole batch.
  const { data: cats } = await sb.from("categories").select("id, name");
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);

  // Known family healthcare providers — one fetch shared by the whole batch.
  const { data: provRows } = await sb
    .from("family_providers")
    .select("display_name, full_name, specialty, clinic");
  const knownProviders = (provRows ?? []) as KnownProvider[];

  const results = await mapWithConcurrency(batch, CONCURRENCY, async (key) => {
    try {
      const rawDescs = await rawDescriptionsForKeyDirect(key);
      if (!rawDescs.length) {
        return { key, ok: false, error: "no descriptions" };
      }
      const name = clusterFor(rawDescs[0]).name;
      const cnpj = extractCnpj(rawDescs);
      const cnpjData = cnpj ? await lookupCnpj(cnpj) : null;

      // Current (most common) category for this cluster
      const { data: txCats } = await sb
        .from("transactions")
        .select("category_id")
        .in("description_raw", rawDescs.slice(0, 200))
        .eq("is_fake", false)
        .limit(1000);
      const counts = new Map<string, number>();
      for (const t of txCats ?? []) {
        if (t.category_id) counts.set(t.category_id as string, (counts.get(t.category_id as string) ?? 0) + 1);
      }
      const topCatId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const currentCategoryName = topCatId ? catNameById.get(topCatId) ?? null : null;

      const aiResult = await researchMerchant(name, rawDescs, cnpjData, currentCategoryName, knownProviders);

      const { error } = await sb.from("merchant_research").upsert(
        {
          canonical_key: key,
          verdict: aiResult.verdict,
          summary: aiResult.summary,
          what_does: aiResult.whatDoes,
          website: aiResult.website,
          segment: aiResult.segment,
          reclame_aqui: aiResult.reclameAqui,
          suggested_category_slug: aiResult.suggestedCategorySlug,
          cnpj,
          cnpj_data: cnpjData,
          sources: aiResult.sources,
          model: "gemini-2.5-flash",
          updated_at: new Date().toISOString()
        },
        { onConflict: "canonical_key" }
      );
      return error ? { key, ok: false, error: error.message } : { key, ok: true, verdict: aiResult.verdict };
    } catch (e) {
      return { key, ok: false, error: (e as Error).message };
    }
  });

  await writeAudit("merchant.research_bulk", {
    newValue: { processed: results.length, ok: results.filter((r) => r.ok).length }
  });

  return NextResponse.json({
    processed: results.length,
    remaining: pending.length - results.length,
    done: pending.length - results.length <= 0,
    results
  });
}
