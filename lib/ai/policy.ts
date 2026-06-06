import "server-only";
import { Type } from "@google/genai";
import { vertex, PRO_MODEL } from "./vertex";

// ============================================================================
// Policy brain — extract a Brazilian health-insurance policy (PDF) into
// structured, VERIFIABLE coverage rules with Gemini 2.5 Pro on Vertex.
// Gemini reads the PDF natively (no separate text extractor needed).
//
// Every coverage rule carries source_quote: the exact verbatim policy text it
// is based on, so a human can verify it. Unstated values are null — never
// invented. Mirrors db/migrations/0018 (insurance_policies / policy_dependents /
// policy_coverage_rules).
// ============================================================================

export type ExtractedRule = {
  category: string;
  procedure_keywords: string[];
  reimbursement_pct: number | null;
  reimbursement_cap: number | null;
  multiple_value: number | null;
  multiple_count: number | null;
  annual_limit_amount: number | null;
  annual_limit_count: number | null;
  limit_period: string | null;
  waiting_period_days: number | null;
  requires_prescription: boolean;
  requires_report: boolean;
  source_quote: string;
  notes: string | null;
};

export type ExtractedDependent = {
  name: string;
  cpf: string | null;
  relationship: string | null;
  birth_date: string | null;
};

export type ExtractedPolicy = {
  policy: {
    insurer_name: string;
    plan_name: string | null;
    policy_number: string | null;
    policy_type: string; // saude | odonto | outro
    holder_name: string | null;
    holder_cpf: string | null;
    reimbursement_model: string | null;
    annual_ceiling: number | null;
    effective_from: string | null;
    effective_to: string | null;
    extraction_confidence: string; // high | medium | low
  };
  dependents: ExtractedDependent[];
  coverage_rules: ExtractedRule[];
};

const SYSTEM = `Você é especialista em reembolso de planos de saúde brasileiros.
Extraia a apólice/manual de reembolso em regras ESTRUTURADAS e VERIFICÁVEIS.

REGRAS CRÍTICAS:
- Seja preciso e conservador: se um valor NÃO estiver escrito, use null. NUNCA invente
  percentuais, tetos, limites ou carências.
- Toda coverage_rule DEVE ter source_quote: o trecho EXATO e literal da apólice em que a
  regra se baseia (para conferência humana). Não parafraseie o source_quote.
- Capture, por categoria de procedimento: percentual de reembolso (reimbursement_pct, fração 0-1),
  teto por evento/sessão (reimbursement_cap), múltiplo (US/CH → multiple_value × multiple_count),
  teto anual (annual_limit_amount), limite de sessões/quantidade por período (annual_limit_count +
  limit_period), carência (waiting_period_days), e se exige pedido médico (requires_prescription)
  ou laudo/relatório (requires_report).
- Categorias: consulta, exame, exame_imagem, terapia, psicoterapia, fisioterapia, internacao,
  odonto, vacina, medicamento, outro. Uma regra por categoria com tratamento distinto.
- procedure_keywords: palavras/TUSS que identificam uma nota fiscal pertencente à categoria.
- annual_ceiling no nível da apólice é o teto GLOBAL de reembolso anual, se houver.
- Retorne JSON estrito conforme o schema.`;

const RULE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING },
    procedure_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    reimbursement_pct: { type: Type.NUMBER, nullable: true },
    reimbursement_cap: { type: Type.NUMBER, nullable: true },
    multiple_value: { type: Type.NUMBER, nullable: true },
    multiple_count: { type: Type.NUMBER, nullable: true },
    annual_limit_amount: { type: Type.NUMBER, nullable: true },
    annual_limit_count: { type: Type.INTEGER, nullable: true },
    limit_period: { type: Type.STRING, nullable: true },
    waiting_period_days: { type: Type.INTEGER, nullable: true },
    requires_prescription: { type: Type.BOOLEAN },
    requires_report: { type: Type.BOOLEAN },
    source_quote: { type: Type.STRING },
    notes: { type: Type.STRING, nullable: true },
  },
  required: ["category", "requires_prescription", "requires_report", "source_quote"],
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    policy: {
      type: Type.OBJECT,
      properties: {
        insurer_name: { type: Type.STRING },
        plan_name: { type: Type.STRING, nullable: true },
        policy_number: { type: Type.STRING, nullable: true },
        policy_type: { type: Type.STRING },
        holder_name: { type: Type.STRING, nullable: true },
        holder_cpf: { type: Type.STRING, nullable: true },
        reimbursement_model: { type: Type.STRING, nullable: true },
        annual_ceiling: { type: Type.NUMBER, nullable: true },
        effective_from: { type: Type.STRING, nullable: true },
        effective_to: { type: Type.STRING, nullable: true },
        extraction_confidence: { type: Type.STRING },
      },
      required: ["insurer_name", "policy_type", "extraction_confidence"],
    },
    dependents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          cpf: { type: Type.STRING, nullable: true },
          relationship: { type: Type.STRING, nullable: true },
          birth_date: { type: Type.STRING, nullable: true },
        },
        required: ["name"],
      },
    },
    coverage_rules: { type: Type.ARRAY, items: RULE_SCHEMA },
  },
  required: ["policy", "dependents", "coverage_rules"],
};

// Extract a policy PDF (base64) into structured rules. Does NOT persist —
// the caller reviews, then saves via the policies API.
export async function extractPolicyFromPdf(
  base64: string,
  mimeType = "application/pdf"
): Promise<ExtractedPolicy> {
  const ai = vertex();
  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text:
              "Extraia esta apólice de plano de saúde nas regras estruturadas de reembolso. " +
              "Inclua source_quote literal em cada regra.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
    },
  });

  const text = response.text ?? "{}";
  return JSON.parse(text) as ExtractedPolicy;
}
