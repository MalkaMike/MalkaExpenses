import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guarantees that at least one row exists in merchant_clusters for the given
 * canonical_key. Needed because the page renders merchants via clusterFor()
 * which can fall through to a "slug fallback" that generates a key from the
 * description_raw without ever writing to merchant_clusters. In that case,
 * UPDATE ... WHERE canonical_key = X matches 0 rows and silently saves nothing.
 *
 * Strategy:
 *  1. If rows already exist → return true immediately (fast path).
 *  2. Otherwise, fetch all distinct description_raws from transactions,
 *     apply the same slug algorithm used in clusters.ts, collect matching
 *     descriptions, and upsert them as new cluster rows.
 *  3. Returns false only when no transaction with this slug key can be found
 *     (merchant was deleted from transactions without cleaning up the URL).
 */
export async function ensureClusterRowsExist(
  canonical_key: string,
  sb: SupabaseClient
): Promise<boolean> {
  // Fast path: rows already exist
  const { data: existing } = await sb
    .from("merchant_clusters")
    .select("id")
    .eq("canonical_key", canonical_key)
    .limit(1);

  if (existing && existing.length > 0) return true;

  // Slug-fallback path: no rows exist — find the raw descriptions
  const slugify = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "unknown";

  // Paginated: PostgREST caps responses at 1000 rows and the ledger has
  // 5,645+ non-fake rows — the old unpaginated read only ever saw an
  // arbitrary 1000 descriptions, so slug-fallback merchants outside that
  // window kept 404ing on merge/tag (the c70fd6c bug, resurfaced).
  const descSet = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: pageErr } = await sb
      .from("transactions")
      .select("description_raw")
      .eq("is_fake", false)
      .range(from, from + PAGE - 1);
    if (pageErr) throw new Error(`ensureClusterRowsExist scan failed: ${pageErr.message}`);
    for (const r of page ?? []) descSet.add((r as { description_raw: string }).description_raw);
    if (!page || page.length < PAGE) break;
  }

  const matchingDescs = [...descSet].filter((d) => slugify(d) === canonical_key);

  if (matchingDescs.length === 0) return false;

  const rows = matchingDescs.map((desc) => ({
    description_raw: desc,
    canonical_key,
    canonical_name: desc,
    is_reviewed: false,
    is_deferred: false,
  }));

  const { error: upsertErr } = await sb
    .from("merchant_clusters")
    .upsert(rows, { onConflict: "description_raw", ignoreDuplicates: true });
  // Returning true after a failed write would make callers proceed and 404
  // (or worse, silently no-op) one step later.
  if (upsertErr) throw new Error(`ensureClusterRowsExist upsert failed: ${upsertErr.message}`);

  return true;
}
