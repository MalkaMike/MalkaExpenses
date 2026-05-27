import "server-only";
import { Type } from "@google/genai";
import { vertex, FLASH_MODEL } from "./vertex";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/categories/meta";

// ============================================================================
// Batch transaction categorization with Gemini 2.5 Flash.
// One LLM call categorizes up to N transactions at once for cost efficiency.
// Returns confidence (0-1) + short reasoning per item.
// ============================================================================

export type CategorizeInput = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed; negative = expense
};

export type CategorizeResult = {
  id: string;
  category_slug: string;
  confidence: number;
  reasoning: string;
};

const SYSTEM = `Você categoriza transações bancárias brasileiras. Retorne JSON estrito.

Categorias disponíveis (use exatamente o slug):
${CATEGORY_ORDER.map((s) => `- ${s} (${CATEGORY_META[s].name})`).join("\n")}

Regras:
- "receita" = entradas de dinheiro (salário, transferências recebidas, vendas, dividendos)
- "transferencias" = movimentações entre contas próprias (TED/PIX entre contas do mesmo dono)
- "cartao_pagamento" = pagamento de fatura de cartão de crédito (sai do banco para a fatura)
- Se ambíguo, use "outros" com confidence baixa
- Confidence = 0..1; use 0.95+ apenas se for um comerciante claramente identificável (ex: UBER, IFOOD, SUPERMERCADO)
- reasoning: 1 frase curta em português explicando

Exemplos:
- "IFOOD" amount=-45 → restaurantes, 0.98
- "UBER * VIAGEM" → transporte, 0.97
- "NETFLIX.COM" → assinaturas, 0.98
- "SALARIO INGAIA" amount=+12000 → receita, 0.95
- "PAG FATURA NUBANK" amount=-2500 → cartao_pagamento, 0.95
- "PIX RECEBIDO" amount=+500 → receita, 0.6 (não sabemos quem mandou)
- "SUPERMERCADO ZONA SUL" → mercado, 0.97`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          category_slug: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING }
        },
        required: ["id", "category_slug", "confidence", "reasoning"]
      }
    }
  },
  required: ["results"]
};

const VALID_SLUGS: Set<string> = new Set(CATEGORY_ORDER);

export async function categorizeBatch(
  items: CategorizeInput[]
): Promise<CategorizeResult[]> {
  if (items.length === 0) return [];

  const ai = vertex();
  const prompt = items
    .map(
      (t) =>
        `id=${t.id} | date=${t.date} | amount=${t.amount.toFixed(2)} | desc="${t.description.replace(/"/g, "'")}"`
    )
    .join("\n");

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
      // Disable "thinking" for snappy structured output. Schema enforces format.
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  const text = response.text ?? "{}";
  let parsed: { results?: CategorizeResult[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return items.map((t) => ({
      id: t.id,
      category_slug: "outros",
      confidence: 0,
      reasoning: "parse error"
    }));
  }
  const results = parsed.results ?? [];

  // Sanitize: ensure every item has a valid slug + 0..1 confidence
  const byId = new Map<string, CategorizeResult>();
  for (const r of results) {
    const slug = VALID_SLUGS.has(r.category_slug) ? r.category_slug : "outros";
    const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    byId.set(r.id, {
      id: r.id,
      category_slug: slug,
      confidence: conf,
      reasoning: String(r.reasoning ?? "").slice(0, 200)
    });
  }

  return items.map(
    (t) =>
      byId.get(t.id) ?? {
        id: t.id,
        category_slug: "outros",
        confidence: 0,
        reasoning: "missing from AI response"
      }
  );
}

// Helper: chunk a large list into manageable batches (40 per call)
export async function categorizeAll(
  items: CategorizeInput[]
): Promise<CategorizeResult[]> {
  const BATCH = 40;
  const out: CategorizeResult[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const r = await categorizeBatch(slice);
    out.push(...r);
  }
  return out;
}
