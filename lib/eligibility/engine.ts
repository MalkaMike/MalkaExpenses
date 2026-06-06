import "server-only";
import { PRO_MODEL } from "@/lib/ai/vertex";
import { mapNfToRule } from "@/lib/ai/eligibility";
import type {
  CoverageRule,
  Dependent,
  EligibilityDetail,
  EngineInput,
  EngineResult,
  GateResult,
  PolicyTerm,
  PriorClaim,
} from "./types";

// ============================================================================
// Deterministic orchestration of the medical-bill eligibility decision.
// One LLM call (lib/ai/eligibility.ts) maps NF -> rule; everything else is
// deterministic math + gates. Each gate carries the verbatim source_quote from
// the policy when relevant, so the UI can show "why" for every decision.
// ============================================================================

const FILING_LIMIT_YEARS = 2; // per APRIL General Conditions

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}
function dateOnly(s: string): string {
  return (s || "").slice(0, 10);
}
function addYears(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Gates ────────────────────────────────────────────────────────────────────

function gateFilingDeadline(emissionDate: string, now: Date): GateResult {
  const deadline = addYears(dateOnly(emissionDate), FILING_LIMIT_YEARS);
  const today = todayIso(now);
  if (today > deadline) {
    return {
      name: "filing_deadline",
      status: "fail",
      detail: `Fora do prazo: emissão ${dateOnly(emissionDate)}, prazo ${deadline}, hoje ${today}.`,
      source_quote: null,
      term_id: null,
    };
  }
  return {
    name: "filing_deadline",
    status: "pass",
    detail: `Dentro do prazo de 2 anos a partir da emissão (até ${deadline}).`,
    source_quote: null,
    term_id: null,
  };
}

function findTerm(terms: PolicyTerm[], predicate: (t: PolicyTerm) => boolean): PolicyTerm | null {
  return terms.find(predicate) ?? null;
}

function attachFilingSource(terms: PolicyTerm[], gate: GateResult): GateResult {
  const term = findTerm(
    terms,
    (t) => t.term_type === "claim_rule" && /prazo|filing|2 anos|two years/i.test(`${t.title ?? ""} ${t.text}`)
  );
  if (term) {
    gate.source_quote = term.source_quote ?? term.text;
    gate.term_id = term.id;
  }
  return gate;
}

function gatePatientCovered(
  resolvedDepId: string | null,
  dependents: Dependent[],
  patientName: string | null
): GateResult {
  if (resolvedDepId) {
    const dep = dependents.find((d) => d.id === resolvedDepId);
    return {
      name: "patient_covered",
      status: "pass",
      detail: `Paciente: ${dep?.name ?? "(coberto)"}.`,
    };
  }
  if (!patientName) {
    return {
      name: "patient_covered",
      status: "warn",
      detail: "Paciente não informado na nota — confirme manualmente.",
    };
  }
  return {
    name: "patient_covered",
    status: "fail",
    detail: `Paciente "${patientName}" não foi mapeado para nenhum beneficiário da apólice.`,
  };
}

function gateZona(coverZone: string | null): GateResult {
  // The app is being used from Brazil. Brazil ∈ Zone 2 per the safe (resolved earlier).
  // Anything outside Zone 2 needs manual review.
  if (!coverZone) {
    return { name: "zona", status: "n/a", detail: "Zona não informada na apólice." };
  }
  return {
    name: "zona",
    status: "pass",
    detail: `Cobertura geográfica: Zona ${coverZone} (inclui Brasil + zonas 3, 4, 5).`,
  };
}

function gateExclusion(exclusionId: string | null, terms: PolicyTerm[]): GateResult {
  if (!exclusionId) {
    return { name: "exclusion", status: "pass", detail: "Nenhuma exclusão da apólice se aplica." };
  }
  const term = terms.find((t) => t.id === exclusionId);
  return {
    name: "exclusion",
    status: "fail",
    detail: `Serviço cai em exclusão da apólice${term?.title ? `: ${term.title}` : ""}.`,
    source_quote: term?.source_quote ?? term?.text ?? null,
    term_id: term?.id ?? null,
  };
}

function gateDeductible(deductibleText: string | null): GateResult {
  const normalized = (deductibleText ?? "").toLowerCase();
  if (!deductibleText || normalized.includes("sans franchise") || normalized.includes("no deductible")) {
    return { name: "deductible", status: "n/a", detail: "Apólice sem franquia." };
  }
  return {
    name: "deductible",
    status: "warn",
    detail: `Franquia da apólice: ${deductibleText}. Considere antes do reembolso.`,
  };
}

function gateWaitingPeriod(
  rule: CoverageRule,
  effectiveFrom: string | null | undefined,
  emissionDate: string,
  terms: PolicyTerm[]
): GateResult {
  if (!rule.waiting_period_days || rule.waiting_period_days <= 0) {
    return { name: "waiting_period", status: "n/a", detail: "Sem carência para esta cobertura." };
  }
  if (!effectiveFrom) {
    return {
      name: "waiting_period",
      status: "warn",
      detail: `Carência de ${rule.waiting_period_days} dias na regra, mas a data de início da apólice não está registrada.`,
    };
  }
  const start = new Date(dateOnly(effectiveFrom) + "T00:00:00Z");
  const event = new Date(dateOnly(emissionDate) + "T00:00:00Z");
  const days = Math.floor((event.getTime() - start.getTime()) / 86400000);
  const term = findTerm(terms, (t) => t.term_type === "waiting_period");
  if (days < rule.waiting_period_days) {
    return {
      name: "waiting_period",
      status: "fail",
      detail: `Carência de ${rule.waiting_period_days} dias; faltam ${rule.waiting_period_days - days} dias.`,
      source_quote: term?.source_quote ?? null,
      term_id: term?.id ?? null,
    };
  }
  return {
    name: "waiting_period",
    status: "pass",
    detail: `Carência de ${rule.waiting_period_days} dias cumprida.`,
    source_quote: term?.source_quote ?? null,
    term_id: term?.id ?? null,
  };
}

function gatePrescription(
  rule: CoverageRule,
  hasPrescription: boolean,
  terms: PolicyTerm[]
): GateResult {
  if (!rule.requires_prescription) {
    return { name: "prescription", status: "n/a", detail: "Esta regra não exige pedido médico." };
  }
  const term = findTerm(
    terms,
    (t) => t.term_type === "required_document" && /pedido|prescri|prescription/i.test(t.text)
  );
  if (hasPrescription) {
    return {
      name: "prescription",
      status: "pass",
      detail: "Pedido médico anexado.",
      source_quote: term?.source_quote ?? null,
      term_id: term?.id ?? null,
    };
  }
  return {
    name: "prescription",
    status: "fail",
    detail: "Pedido médico exigido por esta cobertura — falta anexar.",
    source_quote: term?.source_quote ?? null,
    term_id: term?.id ?? null,
  };
}

function gatePreauth(rule: CoverageRule, terms: PolicyTerm[]): GateResult {
  if (!rule.requires_preauth) {
    return { name: "preauth", status: "n/a", detail: "Pré-autorização não exigida." };
  }
  const term = findTerm(
    terms,
    (t) => t.term_type === "required_document" && /pre.?aproval|pré.?autoriza|preauth/i.test(t.text)
  );
  // We don't track preauth documents in v1; flag as warn so the user can decide.
  return {
    name: "preauth",
    status: "warn",
    detail: "Esta cobertura exige pré-autorização. Confirme se foi solicitada antes do atendimento.",
    source_quote: term?.source_quote ?? null,
    term_id: term?.id ?? null,
  };
}

function gatePaymentProof(paymentStatus: string | null): GateResult {
  if (!paymentStatus || paymentStatus === "no_proof") {
    return {
      name: "payment_proof",
      status: "warn",
      detail: "Sem comprovante de pagamento no banco. Eligibilidade não exige, mas o reembolso exige.",
    };
  }
  if (paymentStatus === "paid_full") {
    return { name: "payment_proof", status: "pass", detail: "Pagamento integral localizado." };
  }
  if (paymentStatus === "paying") {
    return {
      name: "payment_proof",
      status: "warn",
      detail: "Pagamento em andamento (parcelado). Você pode reembolsar parcialmente conforme paga.",
    };
  }
  return { name: "payment_proof", status: "warn", detail: `Status de pagamento: ${paymentStatus}.` };
}

// ── Math ─────────────────────────────────────────────────────────────────────

function computeAnnualUsed(prior: PriorClaim[], ruleId: string, year: number): number {
  return prior
    .filter((p) => p.rule_id === ruleId && p.nf_emission_date && yearOf(p.nf_emission_date) === year)
    .reduce((s, p) => s + (Number(p.eligible_amount) || 0), 0);
}

function applyCapsAndPct(
  gross: number,
  rule: CoverageRule,
  annualUsedBefore: number
): {
  coverage_pct: number | null;
  cap_per_event: number | null;
  multiple_value: number | null;
  multiple_count: number | null;
  computed_before_cap: number;
  computed_after_cap: number;
  annual_limit_amount: number | null;
  annual_remaining: number | null;
  final_eligible: number;
} {
  const pct = rule.reimbursement_pct;
  const cap = rule.reimbursement_cap;
  const mulVal = rule.multiple_value;
  const mulCnt = rule.multiple_count;

  // Compute the basis. Priorities:
  //   1. If rule defines a multiple (US/CH), use multiple_value * multiple_count as the ceiling.
  //   2. Else if pct, apply pct to gross.
  //   3. Else if no pct/multiple but a cap exists, default to gross (capped below).
  //   4. Else: 100% covered (interpret coverage_basis textually upstream; here we default to gross).
  let beforeCap = gross;
  if (mulVal && mulCnt) {
    beforeCap = mulVal * mulCnt; // the rule's intrinsic ceiling
  } else if (typeof pct === "number") {
    beforeCap = gross * pct;
  }

  const afterCap = cap != null ? Math.min(beforeCap, cap) : beforeCap;

  const annualLimit = rule.annual_limit_amount;
  const annualRemaining = annualLimit != null ? Math.max(0, annualLimit - annualUsedBefore) : null;
  const final =
    annualRemaining != null ? Math.min(afterCap, annualRemaining) : afterCap;

  return {
    coverage_pct: pct,
    cap_per_event: cap,
    multiple_value: mulVal,
    multiple_count: mulCnt,
    computed_before_cap: round2(beforeCap),
    computed_after_cap: round2(afterCap),
    annual_limit_amount: annualLimit,
    annual_remaining: annualRemaining != null ? round2(annualRemaining) : null,
    final_eligible: round2(Math.max(0, final)),
  };
}

// ── Status reduction ─────────────────────────────────────────────────────────

function reduceEligibility(args: {
  gates: GateResult[];
  finalEligible: number;
  gross: number;
  hasAppliedRule: boolean;
  aiConfidence: "high" | "medium" | "low";
  annualLimit: number | null;
  annualRemaining: number | null;
}):
  | "eligible"
  | "partial"
  | "not_eligible"
  | "over_limit"
  | "needs_review"
  | "needs_prescription"
  | "needs_preauth"
  | "out_of_filing_window" {
  const { gates, finalEligible, gross, hasAppliedRule, aiConfidence, annualLimit, annualRemaining } = args;

  const deadlineFail = gates.find((g) => g.name === "filing_deadline" && g.status === "fail");
  if (deadlineFail) return "out_of_filing_window";

  const exclusionFail = gates.find((g) => g.name === "exclusion" && g.status === "fail");
  if (exclusionFail) return "not_eligible";

  const presFail = gates.find((g) => g.name === "prescription" && g.status === "fail");
  if (presFail) return "needs_prescription";

  if (!hasAppliedRule || aiConfidence === "low") return "needs_review";

  // Over-limit: annual cap exists and is fully consumed
  if (annualLimit != null && annualRemaining != null && annualRemaining <= 0) {
    return "over_limit";
  }

  // Pre-auth required but unknown -> needs_preauth only if explicitly required AND status is fail
  const preauthFail = gates.find((g) => g.name === "preauth" && g.status === "fail");
  if (preauthFail) return "needs_preauth";

  // Patient mapping failure -> needs review (don't claim eligibility for an unmapped person)
  const patientFail = gates.find((g) => g.name === "patient_covered" && g.status === "fail");
  if (patientFail) return "needs_review";

  if (finalEligible <= 0) return "not_eligible";
  if (finalEligible < gross) return "partial";
  return "eligible";
}

// ── PT-BR reasoning template ─────────────────────────────────────────────────

function buildReasoning(
  eligibility: EngineResult["eligibility"],
  rule: CoverageRule | null,
  finalEligible: number,
  gross: number,
  annualRemaining: number | null
): string {
  switch (eligibility) {
    case "eligible":
      return `Coberto integralmente${rule?.benefit_name ? ` por "${rule.benefit_name}"` : ""}. Valor reembolsável: ${finalEligible.toFixed(2)}.`;
    case "partial":
      return `Coberto parcialmente${rule?.benefit_name ? ` por "${rule.benefit_name}"` : ""}. Reembolsável: ${finalEligible.toFixed(2)} de ${gross.toFixed(2)}.`;
    case "over_limit":
      return `Teto anual já consumido${rule?.benefit_name ? ` para "${rule.benefit_name}"` : ""}. Disponível: ${(annualRemaining ?? 0).toFixed(2)}.`;
    case "not_eligible":
      return "Não elegível para reembolso (regra de exclusão ou regra inaplicável).";
    case "needs_review":
      return "Precisa de revisão manual — mapeamento automático com baixa confiança ou sem regra aplicável.";
    case "needs_prescription":
      return "Cobertura aplicável, mas a regra exige o pedido médico — falta anexar para liberar o reembolso.";
    case "needs_preauth":
      return "Cobertura aplicável, mas a regra exige pré-autorização do plano antes do atendimento.";
    case "out_of_filing_window":
      return "Fora do prazo de 2 anos para envio de reembolso (Condições Gerais APRIL).";
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function determineEligibility(input: EngineInput): Promise<EngineResult> {
  const now = new Date();
  const { nf, policy, rules, terms, dependents, prescription, prior_claims } = input;

  // 0. Hard pre-checks
  if (!nf.is_medical || !nf.is_reimbursable || !nf.total_amount || nf.total_amount <= 0 || !nf.emission_date) {
    return makeResult({
      eligibility: "needs_review",
      eligible_amount: 0,
      applied_rule: null,
      reasoning: "Nota não elegível para reembolso (não é médica, valor ausente ou data de emissão ausente).",
      confidence: "low",
      annual_used_before: 0,
      deadline_date: null,
      detail: {
        category_match: {
          ai_category: "outro",
          ai_confidence: "low",
          ai_reasoning: "Pré-condições básicas não atendidas — não acionei o modelo.",
          candidate_rule_ids: [],
          patient_dependent_id: null,
          exclusion_term_id: null,
        },
        applied_rule: null,
        calculation: emptyCalc(nf.total_amount, policy.currency),
        gates: [],
        deadline_date: null,
        ai_model_used: null,
        determined_at: now.toISOString(),
      },
    });
  }

  // 1. Filing deadline early-exit (saves a Gemini call when out of window)
  const deadlineDate = addYears(dateOnly(nf.emission_date), FILING_LIMIT_YEARS);
  const filingGate = attachFilingSource(terms, gateFilingDeadline(nf.emission_date, now));
  if (filingGate.status === "fail") {
    return makeResult({
      eligibility: "out_of_filing_window",
      eligible_amount: 0,
      applied_rule: null,
      reasoning: buildReasoning("out_of_filing_window", null, 0, nf.total_amount, null),
      confidence: "high",
      annual_used_before: 0,
      deadline_date: deadlineDate,
      detail: {
        category_match: {
          ai_category: "outro",
          ai_confidence: "high",
          ai_reasoning: "Não acionei o modelo — claim fora do prazo de 2 anos.",
          candidate_rule_ids: [],
          patient_dependent_id: null,
          exclusion_term_id: null,
        },
        applied_rule: null,
        calculation: emptyCalc(nf.total_amount, policy.currency),
        gates: [filingGate],
        deadline_date: deadlineDate,
        ai_model_used: null,
        determined_at: now.toISOString(),
      },
    });
  }

  // 2. LLM mapping (the only AI call)
  let ai;
  try {
    ai = await mapNfToRule({
      service_description: nf.service_description,
      provider_name: nf.provider_name,
      patient_name: nf.patient_name,
      total_amount: nf.total_amount,
      rules,
      terms,
      dependents,
    });
  } catch (e) {
    return makeResult({
      eligibility: "needs_review",
      eligible_amount: 0,
      applied_rule: null,
      reasoning: `Falha na análise automática (${(e as Error).message.slice(0, 100)}). Tente novamente.`,
      confidence: "low",
      annual_used_before: 0,
      deadline_date: deadlineDate,
      detail: {
        category_match: {
          ai_category: "outro",
          ai_confidence: "low",
          ai_reasoning: "Falha na chamada ao modelo.",
          candidate_rule_ids: [],
          patient_dependent_id: null,
          exclusion_term_id: null,
        },
        applied_rule: null,
        calculation: emptyCalc(nf.total_amount, policy.currency),
        gates: [filingGate],
        deadline_date: deadlineDate,
        ai_model_used: PRO_MODEL,
        determined_at: now.toISOString(),
      },
    });
  }

  const appliedRule = ai.primary_rule_id ? rules.find((r) => r.id === ai.primary_rule_id) ?? null : null;

  // 3. Deterministic gates
  const gates: GateResult[] = [filingGate];
  gates.push(gatePatientCovered(ai.patient_dependent_id, dependents, nf.patient_name));
  gates.push(gateZona(policy.cover_zone));
  gates.push(gateExclusion(ai.exclusion_term_id, terms));
  gates.push(gateDeductible(policy.deductible_text));

  if (appliedRule) {
    gates.push(gateWaitingPeriod(appliedRule, policy.effective_from ?? null, nf.emission_date, terms));
    gates.push(gatePrescription(appliedRule, !!prescription, terms));
    gates.push(gatePreauth(appliedRule, terms));
  }
  gates.push(gatePaymentProof(nf.payment_status));

  // 4. Math
  const year = yearOf(dateOnly(nf.emission_date));
  const annualUsedBefore = appliedRule
    ? computeAnnualUsed(prior_claims, appliedRule.id, year)
    : 0;

  const calc = appliedRule
    ? applyCapsAndPct(nf.total_amount, appliedRule, annualUsedBefore)
    : {
        coverage_pct: null as number | null,
        cap_per_event: null as number | null,
        multiple_value: null as number | null,
        multiple_count: null as number | null,
        computed_before_cap: 0,
        computed_after_cap: 0,
        annual_limit_amount: null as number | null,
        annual_remaining: null as number | null,
        final_eligible: 0,
      };

  // 5. Reduce
  const eligibility = reduceEligibility({
    gates,
    finalEligible: calc.final_eligible,
    gross: nf.total_amount,
    hasAppliedRule: !!appliedRule,
    aiConfidence: ai.confidence,
    annualLimit: calc.annual_limit_amount,
    annualRemaining: calc.annual_remaining,
  });

  // If we ended up "eligible" but the verdict should be capped by a failed gate
  // that isn't deadline/exclusion/prescription (e.g. patient), reduceEligibility
  // already handled that. Final amount: 0 for fail-class states.
  const finalAmount = ["eligible", "partial"].includes(eligibility) ? calc.final_eligible : 0;

  const reasoning = buildReasoning(
    eligibility,
    appliedRule,
    finalAmount,
    nf.total_amount,
    calc.annual_remaining
  );

  return makeResult({
    eligibility,
    eligible_amount: finalAmount,
    applied_rule: appliedRule,
    reasoning,
    confidence: ai.confidence,
    annual_used_before: annualUsedBefore,
    deadline_date: deadlineDate,
    detail: {
      category_match: {
        ai_category: ai.category,
        ai_confidence: ai.confidence,
        ai_reasoning: ai.reasoning,
        candidate_rule_ids: ai.candidate_rule_ids,
        patient_dependent_id: ai.patient_dependent_id,
        exclusion_term_id: ai.exclusion_term_id,
      },
      applied_rule: appliedRule
        ? {
            id: appliedRule.id,
            section: appliedRule.section,
            benefit_name: appliedRule.benefit_name,
            coverage_basis: appliedRule.coverage_basis,
            source_quote: appliedRule.source_quote,
          }
        : null,
      calculation: {
        gross_amount: nf.total_amount,
        coverage_pct: calc.coverage_pct,
        cap_per_event: calc.cap_per_event,
        multiple_value: calc.multiple_value,
        multiple_count: calc.multiple_count,
        computed_before_cap: calc.computed_before_cap,
        computed_after_cap: calc.computed_after_cap,
        annual_limit_amount: calc.annual_limit_amount,
        annual_used_before: annualUsedBefore,
        annual_remaining: calc.annual_remaining,
        final_eligible: finalAmount,
        currency: policy.currency,
      },
      gates,
      deadline_date: deadlineDate,
      ai_model_used: PRO_MODEL,
      determined_at: now.toISOString(),
    },
  });
}

function emptyCalc(gross: number, currency: string | null) {
  return {
    gross_amount: gross,
    coverage_pct: null,
    cap_per_event: null,
    multiple_value: null,
    multiple_count: null,
    computed_before_cap: 0,
    computed_after_cap: 0,
    annual_limit_amount: null,
    annual_used_before: 0,
    annual_remaining: null,
    final_eligible: 0,
    currency,
  };
}

function makeResult(args: {
  eligibility: EngineResult["eligibility"];
  eligible_amount: number;
  applied_rule: CoverageRule | null;
  reasoning: string;
  confidence: EngineResult["confidence"];
  annual_used_before: number;
  deadline_date: string | null;
  detail: EligibilityDetail;
}): EngineResult {
  return {
    eligibility: args.eligibility,
    eligible_amount: args.eligible_amount,
    applied_rule_id: args.applied_rule?.id ?? null,
    reasoning: args.reasoning,
    confidence: args.confidence,
    determined_by: "ai",
    annual_used_before: args.annual_used_before,
    deadline_date: args.deadline_date,
    eligibility_detail: args.detail,
  };
}
