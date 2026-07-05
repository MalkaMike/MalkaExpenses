import { NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { rawDescriptionsForKeyDirect, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { researchMerchant } from "@/lib/ai/merchant-research";
import { extractCnpj, lookupCnpj } from "@/lib/cnpj";

export const runtime = "nodejs";
export const maxDuration = 280;

const BATCH_SIZE = 15;

// POST /api/admin/merchants/research-bulk
// Processes up to BATCH_SIZE not-yet-reviewed merchants per call (skips ones
// already in merchant_research). Client calls this repeatedly until
// `done: true` — each call is bounded to stay under Vercel's timeout.
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

  // Already-researched keys — skip these.
  const { data: doneRows } = await sb.from("merchant_research").select("canonical_key");
  const alreadyDone = new Set((doneRows ?? []).map((r) => r.canonical_key as string));

  const pending = [...allKeys].filter((k) => !alreadyDone.has(k));
  const batch = pending.slice(0, BATCH_SIZE);

  await preloadClusters();

  const results: { key: string; ok: boolean; verdict?: string; error?: string }[] = [];
  for (const key of batch) {
    try {
      const rawDescs = await rawDescriptionsForKeyDirect(key);
      if (!rawDescs.length) {
        results.push({ key, ok: false, error: "no descriptions" });
        continue;
      }
      const name = clusterFor(rawDescs[0]).name;
      const cnpj = extractCnpj(rawDescs);
      const cnpjData = cnpj ? await lookupCnpj(cnpj) : null;
      const aiResult = await researchMerchant(name, rawDescs, cnpjData);

      const { error } = await sb.from("merchant_research").upsert(
        {
          canonical_key: key,
          verdict: aiResult.verdict,
          summary: aiResult.summary,
          cnpj,
          cnpj_data: cnpjData,
          sources: aiResult.sources,
          model: "gemini-2.5-flash",
          updated_at: new Date().toISOString()
        },
        { onConflict: "canonical_key" }
      );
      if (error) {
        results.push({ key, ok: false, error: error.message });
      } else {
        results.push({ key, ok: true, verdict: aiResult.verdict });
      }
    } catch (e) {
      results.push({ key, ok: false, error: (e as Error).message });
    }
  }

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
