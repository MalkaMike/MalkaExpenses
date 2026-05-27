import "server-only";
import { Type } from "@google/genai";
import { vertex, FLASH_MODEL } from "./vertex";
import { CATEGORY_META } from "@/lib/categories/meta";

// ============================================================================
// Batch transaction categorization with Gemini 2.5 Flash.
// One LLM call categorizes up to N transactions at once for cost efficiency.
// Returns confidence (0-1) + short reasoning per item.
// RULE: always pick the most specific subcategory when available.
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

// Build the taxonomy string grouping parents + children for the prompt
function buildTaxonomyPrompt(): string {
  const parents = Object.values(CATEGORY_META).filter((m) => !m.parentSlug);
  const lines: string[] = [];
  for (const p of parents) {
    const children = Object.values(CATEGORY_META).filter(
      (m) => m.parentSlug === p.slug
    );
    if (children.length > 0) {
      lines.push(`[${p.slug}] ${p.name}`);
      for (const c of children) {
        lines.push(`  └─ ${c.slug} — ${c.name}`);
      }
    } else {
      lines.push(`[${p.slug}] ${p.name}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM = `Você categoriza transações bancárias brasileiras. Retorne JSON estrito.

REGRA PRINCIPAL: sempre escolha o slug MAIS ESPECÍFICO disponível (subcategoria > categoria pai).
Exemplo: para gasolina, use "combustivel" e NÃO "transporte".

Taxonomia completa (use exatamente o slug entre colchetes ou após └─):
${buildTaxonomyPrompt()}

Regras especiais:
- "receita" = entradas de dinheiro (salário, transferências recebidas, vendas, dividendos, reembolsos)
- "transferencias" = movimentações entre contas próprias do mesmo titular (TED/PIX interno)
- "cartao_pagamento" = pagamento de fatura de cartão de crédito (sai do banco para a fatura CC)
- "financeiro" = IOF, anuidade, tarifa bancária, Serasa, juros, multas bancárias
- Confidence = 0..1. Use ≥0.90 só se o comerciante for claramente identificável.
- Se confidence < 0.65: use "outros" — não invente categoria.
- reasoning: 1 frase curta em português explicando a decisão.

Exemplos concretos:
- "AUTO POSTO RAMAL" amount=-180 → combustivel, 0.97
- "KLN ESTACIONAMENTO" amount=-25 → estacionamento_pedagio, 0.95
- "UBER * VIAGEM" amount=-32 → uber_taxi, 0.97
- "GOL LINHAS AEREAS" amount=-890 → aereo_rodoviario, 0.97
- "IFD*WR BURGER" amount=-45 → delivery, 0.97
- "IFD*BLUE DELI" amount=-120 → restaurantes, 0.95
- "FEITO A MAO PAO ARTESA" amount=-18 → padaria_cafe, 0.92
- "CLAUDE.AI" amount=-20 → ia_ferramentas, 0.99
- "GROQ INC" amount=-15 → ia_ferramentas, 0.97
- "GITHUB" amount=-10 → dev_cloud, 0.98
- "DL *GOOGLE CLOUD" amount=-6820 → dev_cloud, 0.97
- "CLOUDFLARE" amount=-25 → dev_cloud, 0.96
- "CLICKUP" amount=-30 → produtividade_saas, 0.97
- "GRAMMARLY" amount=-15 → produtividade_saas, 0.95
- "FACEBK *" amount=-500 → marketing_digital, 0.97
- "NETFLIX.COM" amount=-55 → assinaturas, 0.98
- "Google One" amount=-10 → assinaturas, 0.95
- "DROGASIL" amount=-80 → farmacia, 0.98
- "EINSTEIN MORUMBI" amount=-350 → consultas_exames, 0.97
- "ANACA ESTUDIO" amount=-200 → bem_estar, 0.90
- "VITORIA HOTEL CAMPINAS" amount=-450 → hoteis_pousadas, 0.98
- "MELIA CAMPINAS" amount=-980 → hoteis_pousadas, 0.97
- "DECATHLON" amount=-150 → esportes_hobby, 0.97
- "H&M" amount=-250 → vestuario, 0.97
- "LEROY MERLIN" amount=-380 → manutencao_casa, 0.97
- "LEGO" amount=-200 → brinquedos_jogos, 0.97
- "EPIC GAMES" amount=-60 → brinquedos_jogos, 0.95
- "SEPHORAELDORADO" amount=-150 → cosmeticos, 0.98
- "TRAMONTINA" amount=-120 → casa_decoracao, 0.90
- "ANUIDADE" amount=-50 → financeiro, 0.95
- "IOF" amount=-12 → financeiro, 0.99
- "SUPERMERCADO ZONA SUL" amount=-320 → mercado, 0.97
- "IFD*ORGANICO OSCAR" amount=-90 → mercado, 0.90
- "SALARIO" amount=+12000 → receita, 0.95
- "PAG FATURA NUBANK" amount=-2500 → cartao_pagamento, 0.97
- "PIX RECEBIDO" amount=+500 → receita, 0.60`;

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

// All valid slugs including subcategories
const VALID_SLUGS: Set<string> = new Set(Object.keys(CATEGORY_META));

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
