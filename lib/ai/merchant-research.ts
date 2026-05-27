import "server-only";
import { vertex, FLASH_MODEL } from "./vertex";
import { CATEGORY_META } from "@/lib/categories/meta";

// ============================================================================
// Merchant research via Vertex AI + Google Search grounding.
//
// Called when AI confidence < 0.65 — the model genuinely does not recognise
// the merchant. We fire a grounded search to let Gemini look it up, then
// extract a category + updated confidence from the answer.
//
// NOTE: Google Search grounding and responseSchema are mutually exclusive in
// the Vertex SDK, so we ask for inline JSON and regex-parse it.
// ============================================================================

export type ResearchResult = {
  id: string;
  category_slug: string;
  confidence: number;
  reasoning: string;
  searched: boolean; // true = web search was performed
};

// All valid slugs for the prompt
const ALL_SLUGS = Object.keys(CATEGORY_META).join(", ");

const RESEARCH_SYSTEM = `Você é um especialista em finanças pessoais brasileiras.
Dado o nome de um comerciante de extrato bancário, use o Google Search para identificar
o tipo de negócio e retorne EXATAMENTE este JSON (nada mais):
{"category_slug":"<slug>","confidence":<0..1>,"reasoning":"<1 frase PT-BR>"}

Slugs disponíveis: ${ALL_SLUGS}

Regras:
- Escolha o slug MAIS ESPECÍFICO (ex: "combustivel" e não "transporte")
- Se ainda não conseguir identificar: {"category_slug":"outros","confidence":0.3,"reasoning":"Comerciante não identificado mesmo com pesquisa"}
- confidence ≥ 0.80 só se a pesquisa confirmou claramente o tipo de negócio`;

/**
 * Research a single merchant description using Google Search grounding.
 * Returns the best category + confidence after web lookup.
 */
async function researchOne(
  id: string,
  description: string,
  amount: number
): Promise<ResearchResult> {
  const ai = vertex();

  const userMsg = `Identifique este comerciante de extrato bancário brasileiro e categorize:
Descrição: "${description}"
Valor: R$ ${Math.abs(amount).toFixed(2)} ${amount < 0 ? "(despesa)" : "(receita)"}

Pesquise no Google pelo nome do comerciante e retorne o JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      config: {
        systemInstruction: RESEARCH_SYSTEM,
        tools: [{ googleSearch: {} }],
        temperature: 0
        // NOTE: no responseSchema — incompatible with googleSearch tool
      }
    });

    const text = (response.text ?? "").trim();

    // Extract JSON from response (may be surrounded by markdown fences)
    const jsonMatch = text.match(/\{[^{}]*"category_slug"[^{}]*\}/);
    if (!jsonMatch) {
      return {
        id,
        category_slug: "outros",
        confidence: 0.3,
        reasoning: "Pesquisa realizada mas resposta não parseável",
        searched: true
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      category_slug?: string;
      confidence?: number;
      reasoning?: string;
    };

    const slug = parsed.category_slug && CATEGORY_META[parsed.category_slug]
      ? parsed.category_slug
      : "outros";

    const conf = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.3));

    return {
      id,
      category_slug: slug,
      confidence: conf,
      reasoning: `Pesquisado: ${String(parsed.reasoning ?? "").slice(0, 180)}`,
      searched: true
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish between "grounding not enabled on project" vs generic network/API errors
    if (msg.includes("not available") || msg.includes("not supported") || msg.includes("googleSearch")) {
      console.error(`[merchant-research] Google Search grounding is not enabled on this Vertex project. Enable it at console.cloud.google.com → Vertex AI → Settings. Error: ${msg}`);
    } else {
      console.error(`[merchant-research] error for "${description}":`, msg);
    }
    return {
      id,
      category_slug: "outros",
      confidence: 0.2,
      reasoning: "Pesquisa falhou — comerciante não identificado",
      searched: true
    };
  }
}

/**
 * Research multiple low-confidence merchants in parallel (up to 5 concurrent).
 * Each call uses Google Search grounding to identify the merchant.
 */
export async function researchMerchants(
  items: Array<{ id: string; description: string; amount: number }>
): Promise<ResearchResult[]> {
  if (items.length === 0) return [];

  // Batch in groups of 5 to avoid overwhelming the API
  const CONCURRENCY = 5;
  const results: ResearchResult[] = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((item) => researchOne(item.id, item.description, item.amount))
    );
    results.push(...batchResults);
  }

  return results;
}
