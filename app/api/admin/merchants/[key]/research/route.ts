import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { rawDescriptionsForKeyDirect, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { researchMerchant } from "@/lib/ai/merchant-research";
import { extractCnpj, lookupCnpj } from "@/lib/cnpj";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/merchants/[key]/research?force=1
// Deep-research an unrecognized merchant: CNPJ registry lookup (if a CNPJ is
// found in the raw description) + one search-grounded Gemini call, cached in
// merchant_research. Pass ?force=1 to re-run instead of returning the cache.
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
    if (existing) return NextResponse.json({ cached: true, result: existing });
  }

  await preloadClusters();
  const rawDescs = await rawDescriptionsForKeyDirect(canonicalKey);
  if (!rawDescs.length) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  const name = clusterFor(rawDescs[0]).name;
  const cnpj = extractCnpj(rawDescs);
  const cnpjData = cnpj ? await lookupCnpj(cnpj) : null;

  let aiResult;
  try {
    aiResult = await researchMerchant(name, rawDescs, cnpjData);
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
