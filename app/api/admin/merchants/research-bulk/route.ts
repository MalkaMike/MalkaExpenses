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
  // nobody has confirmed yet) vs already-researched-in-ficha-format keys,
  // fetched together instead of one after another. Each paginates its own
  // table in parallel in the (currently unlikely) case it exceeds 1000 rows.
  async function fetchColumn(table: "merchant_clusters" | "merchant_research", isPending: boolean): Promise<Set<string>> {
    const base = sb.from(table).select("canonical_key", { count: "exact" });
    const filtered = isPending ? base.eq("is_reviewed", false) : base.not("what_does", "is", null);
    const { data: firstPage, count } = await filtered.range(0, 999);
    const out = new Set((firstPage ?? []).map((r) => r.canonical_key as string));
    const remainingPages = Math.max(0, Math.ceil((count ?? 0) / 1000) - 1);
    if (remainingPages > 0) {
      const base2 = sb.from(table).select("canonical_key");
      const extraPages = await Promise.all(
        Array.from({ length: remainingPages }, (_, i) => {
          const q = isPending ? base2.eq("is_reviewed", false) : base2.not("what_does", "is", null);
          return q.range((i + 1) * 1000, (i + 1) * 1000 + 999);
        })
      );
      for (const { data } of extraPages) for (const r of data ?? []) out.add(r.canonical_key as string);
    }
    return out;
  }

  const [allKeys, alreadyDone] = await Promise.all([
    fetchColumn("merchant_clusters", true),
    fetchColumn("merchant_research", false)
  ]);

  const pending = [...allKeys].filter((k) => !alreadyDone.has(k));
  const batch = pending.slice(0, BATCH_SIZE);

  // Nothing to do — skip the cluster/category/provider preload entirely
  // instead of paying for it on every "already fully researched" check.
  if (batch.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0, done: true, results: [] });
  }

  const [, catsRes, provRes] = await Promise.all([
    preloadClusters(),
    sb.from("categories").select("id, name"),
    sb.from("family_providers").select("display_name, full_name, specialty, clinic")
  ]);
  const catNameById = new Map<string, string>();
  for (const c of catsRes.data ?? []) catNameById.set(c.id as string, c.name as string);
  const knownProviders = (provRes.data ?? []) as KnownProvider[];

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
