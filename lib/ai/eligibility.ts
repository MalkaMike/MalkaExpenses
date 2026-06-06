import "server-only";
import { Type } from "@google/genai";
import { vertex, PRO_MODEL } from "./vertex";
import type {
  AiCategoryMatch,
  CoverageRule,
  PolicyTerm,
  Dependent,
} from "@/lib/eligibility/types";

// ============================================================================
// The ONE AI call in the eligibility pipeline. Given an NF's service_description
// + provider + patient_name, the LLM picks the best-matching policy_coverage_rule
// (or finds an exclusion / resolves the patient). Code does everything else
// (math, limits, dates) — the LLM never computes amounts.
//
// Mirrors the structured-output pattern in lib/ai/policy.ts.
// ============================================================================

const SYSTEM = `Você é especialista em planos de saúde internacionais (APRIL "Ma Santé Internationale" — Premium / Zone 2 / EUR).

Tarefa: dada a descrição livre de uma nota fiscal brasileira (em português), escolha:
1) A categoria do serviço (consulta | exame | exame_imagem | terapia | psicoterapia | fisioterapia | internacao | odonto | vacina | medicamento | outro).
2) A REGRA DE COBERTURA da apólice que melhor se aplica (primary_rule_id), entre as candidatas listadas. Se nenhuma se aplicar, devolva primary_rule_id=null.
3) Top-3 candidatas em ordem de melhor para pior (candidate_rule_ids).
4) Se o serviço bate em alguma EXCLUSÃO listada, devolva exclusion_term_id (e mantenha primary_rule_id também — para auditoria).
5) Resolva o patient_name livre para um dos dependentes da apólice (patient_dependent_id) — caso contrário, null.
6) Confidence (high|medium|low) baseada em quão claro é o match.
7) reasoning: 1-2 frases CURTAS em PT-BR explicando a escolha.

REGRAS DURAS:
- NUNCA calcule valores, percentuais, tetos, ou prazos. Apenas mapeie.
- Se o serviço é AMBÍGUO (várias regras plausíveis) ou se a descrição é genérica demais → confidence='low'.
- Se nenhuma regra se aplicar → primary_rule_id=null, candidate_rule_ids=[], confidence='low'.
- Retorne JSON estrito conforme o schema.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING },
    primary_rule_id: { type: Type.STRING, nullable: true },
    candidate_rule_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
    exclusion_term_id: { type: Type.STRING, nullable: true },
    patient_dependent_id: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING },
    reasoning: { type: Type.STRING },
  },
  required: ["category", "candidate_rule_ids", "confidence", "reasoning"],
};

// Curated views — keep the LLM input small (~70% fewer tokens than raw rows).
type RuleCard = {
  id: string;
  section: string | null;
  benefit_name: string | null;
  category: string | null;
  coverage_basis: string | null;
  procedure_keywords: string[] | null;
};

function cardRule(r: CoverageRule): RuleCard {
  return {
    id: r.id,
    section: r.section,
    benefit_name: r.benefit_name,
    category: r.category,
    coverage_basis: r.coverage_basis,
    procedure_keywords: r.procedure_keywords,
  };
}

type ExclusionCard = { id: string; title: string | null; text: string };
type DependentCard = { id: string; name: string; relationship: string | null };

export async function mapNfToRule(args: {
  service_description: string | null;
  provider_name: string | null;
  patient_name: string | null;
  total_amount: number;
  rules: CoverageRule[];
  terms: PolicyTerm[];
  dependents: Dependent[];
}): Promise<AiCategoryMatch> {
  const ruleCards: RuleCard[] = args.rules.map(cardRule);
  const exclusionCards: ExclusionCard[] = args.terms
    .filter((t) => t.term_type === "exclusion")
    .map((t) => ({ id: t.id, title: t.title, text: t.text }));
  const dependentCards: DependentCard[] = args.dependents.map((d) => ({
    id: d.id,
    name: d.name,
    relationship: d.relationship,
  }));

  const userText = JSON.stringify(
    {
      nota_fiscal: {
        service_description: args.service_description,
        provider_name: args.provider_name,
        patient_name: args.patient_name,
        total_amount: args.total_amount,
      },
      regras_candidatas: ruleCards,
      exclusoes_da_apolice: exclusionCards,
      dependentes_da_apolice: dependentCards,
    },
    null,
    1
  );

  const ai = vertex();
  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
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
  let parsed: AiCategoryMatch;
  try {
    parsed = JSON.parse(text) as AiCategoryMatch;
  } catch {
    parsed = {
      category: "outro",
      primary_rule_id: null,
      candidate_rule_ids: [],
      exclusion_term_id: null,
      patient_dependent_id: null,
      confidence: "low",
      reasoning: "Falha ao interpretar a resposta do modelo.",
    };
  }

  // Sanitize: rule ids must exist in the candidate set
  const validRuleIds = new Set(args.rules.map((r) => r.id));
  const validExclusionIds = new Set(exclusionCards.map((e) => e.id));
  const validDepIds = new Set(dependentCards.map((d) => d.id));

  const cleanCandidates = (parsed.candidate_rule_ids ?? [])
    .filter((id) => validRuleIds.has(id))
    .slice(0, 3);
  const cleanPrimary =
    parsed.primary_rule_id && validRuleIds.has(parsed.primary_rule_id)
      ? parsed.primary_rule_id
      : null;
  const cleanExclusion =
    parsed.exclusion_term_id && validExclusionIds.has(parsed.exclusion_term_id)
      ? parsed.exclusion_term_id
      : null;
  const cleanDep =
    parsed.patient_dependent_id && validDepIds.has(parsed.patient_dependent_id)
      ? parsed.patient_dependent_id
      : null;

  const confidence = (["high", "medium", "low"] as const).includes(
    parsed.confidence as "high" | "medium" | "low"
  )
    ? parsed.confidence
    : "low";

  return {
    category: parsed.category || "outro",
    primary_rule_id: cleanPrimary,
    candidate_rule_ids: cleanCandidates,
    exclusion_term_id: cleanExclusion,
    patient_dependent_id: cleanDep,
    confidence,
    reasoning: (parsed.reasoning ?? "").slice(0, 400),
  };
}
