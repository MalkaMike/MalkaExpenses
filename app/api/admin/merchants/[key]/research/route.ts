import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { rawDescriptionsForKeyDirect, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { researchMerchant, type KnownProvider } from "@/lib/ai/merchant-research";
import { extractCnpj, lookupCnpj } from "@/lib/cnpj";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/[key]/research?force=1
// Deep-research an unrecognized merchant into a full "ficha": CNPJ registry
// lookup (if a CNPJ is found in the raw description) + one search-grounded
// Gemini call (what they do, site, segment, ReclameAqui reputation, fraud
// verdict, category suggestion), cached in merchant_research.
// Rows created before the ficha format (what_does IS NULL) are treated as
// stale and re-researched. Pass ?force=1 to re-run regardless.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAdmin();
  const { key: rawKey } = await params;
  const canonicalKey = decodeURIComponent(rawKey);
  const force = new URL(req.url).searchParams.get("force") === "1";

  const sb = serverClient();

  if (!force) {
    const { data: existing } = await sb
      .from("merchant_research")
      .select("*")
      .eq("canonical_key", canonicalKey)
      .maybeSingle();
    // what_does NULL = pre-ficha row → fall through and re-research
    if (existing && existing.what_does !== null) {
      return NextResponse.json({ cached: true, result: existing });
    }
  }

  await preloadClusters();
  const rawDescs = await rawDescriptionsForKeyDirect(canonicalKey);
  if (!rawDescs.length) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  const name = clusterFor(rawDescs[0]).name;
  const cnpj = extractCnpj(rawDescs);
  const cnpjData = cnpj ? await lookupCnpj(cnpj) : null;

  // Current category (most common across the cluster's transactions) so the
  // model can judge whether a better category applies.
  let currentCategoryName: string | null = null;
  {
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
    if (topCatId) {
      const { data: cat } = await sb.from("categories").select("name").eq("id", topCatId).maybeSingle();
      currentCategoryName = (cat?.name as string) ?? null;
    }
  }

  // Known family healthcare providers — lets the AI recognize a PIX to
  // "Maria B" as a payment to the family's dermatologist.
  const { data: provRows } = await sb
    .from("family_providers")
    .select("display_name, full_name, specialty, clinic");
  const knownProviders = (provRows ?? []) as KnownProvider[];

  let aiResult;
  try {
    aiResult = await researchMerchant(name, rawDescs, cnpjData, currentCategoryName, knownProviders);
  } catch (e) {
    return NextResponse.json({ error: `pesquisa falhou: ${(e as Error).message}` }, { status: 500 });
  }

  const { data: saved, error } = await sb
    .from("merchant_research")
    .upsert(
      {
        canonical_key: canonicalKey,
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
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit("merchant.research", {
    newValue: { canonical_key: canonicalKey, verdict: aiResult.verdict, cnpj }
  });

  return NextResponse.json({ cached: false, result: saved });
}
