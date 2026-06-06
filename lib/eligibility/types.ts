// ============================================================================
// Eligibility engine — shared types. No logic.
//
// Hybrid model:
//   - LLM (one call): NF service_description -> category -> applied_rule + exclusion + patient
//   - Code (everything else): %/caps, annuals, waiting periods, deadline, gates, status reduction
//
// Every verdict carries a full audit trail (EligibilityDetail) including the
// verbatim policy source_quote for the applied rule and any failed gate.
// ============================================================================

export type Eligibility =
  | "eligible"
  | "partial"
  | "not_eligible"
  | "over_limit"
  | "needs_review"
  | "needs_prescription"
  | "needs_preauth"
  | "out_of_filing_window";

export type GateName =
  | "filing_deadline"
  | "patient_covered"
  | "zona"
  | "exclusion"
  | "deductible"
  | "waiting_period"
  | "prescription"
  | "preauth"
  | "payment_proof";

export type GateStatus = "pass" | "fail" | "n/a" | "warn";

export type GateResult = {
  name: GateName;
  status: GateStatus;
  detail: string;
  source_quote?: string | null;
  term_id?: string | null;
};

export type Confidence = "high" | "medium" | "low";

// ── Inputs from the DB (server-fetched before calling the engine) ────────────

export type EligibilityNf = {
  id: string;
  provider_name: string | null;
  service_description: string | null;
  total_amount: number;
  emission_date: string; // YYYY-MM-DD
  patient_name: string | null;
  is_medical: boolean;
  is_reimbursable: boolean;
  payment_status: string | null; // paid_full | paying | scheduled | no_proof
  amount_paid: number | null;
  amount_pending: number | null;
};

export type EligibilityPolicy = {
  id: string;
  insurer_name: string;
  plan_tier: string | null;
  cover_zone: string | null;
  currency: string | null;
  overall_annual_limit: string | null;
  deductible_text: string | null;
  claim_filing_limit: string | null;
  human_confirmed: boolean;
  effective_from?: string | null;
};

export type CoverageRule = {
  id: string;
  policy_id: string;
  section: string | null;
  benefit_name: string | null;
  category: string | null;
  coverage_basis: string | null;
  plan_tier: string | null;
  procedure_keywords: string[] | null;
  reimbursement_pct: number | null;
  reimbursement_cap: number | null;
  multiple_value: number | null;
  multiple_count: number | null;
  annual_limit_amount: number | null;
  annual_limit_count: number | null;
  limit_period: string | null;
  waiting_period_days: number | null;
  requires_preauth: boolean;
  requires_prescription: boolean;
  source_quote: string | null;
  notes: string | null;
  human_confirmed: boolean;
};

export type PolicyTerm = {
  id: string;
  policy_id: string;
  term_type: string; // exclusion | claim_rule | waiting_period | required_document | definition | other
  title: string | null;
  text: string;
  source_quote: string | null;
  source_document: string | null;
  human_confirmed: boolean;
};

export type Dependent = {
  id: string;
  name: string;
  relationship: string | null;
  birth_date: string | null;
};

export type MedicalDocument = {
  id: string;
  doc_type: string;
  doctor_name: string | null;
  doctor_crm: string | null;
  patient_name: string | null;
  issue_date: string | null;
  description: string | null;
};

export type PriorClaim = {
  rule_id: string | null;
  eligible_amount: number | null;
  nf_emission_date: string | null;
};

export type EngineInput = {
  nf: EligibilityNf;
  policy: EligibilityPolicy;
  rules: CoverageRule[];
  terms: PolicyTerm[];
  dependents: Dependent[];
  prescription: MedicalDocument | null;
  prior_claims: PriorClaim[]; // same patient, prior claims (any rule), for annual-limit math
};

// ── LLM output (the only AI call) ────────────────────────────────────────────

export type AiCategoryMatch = {
  category: string; // consulta | exame | exame_imagem | terapia | psicoterapia | fisioterapia | internacao | odonto | vacina | medicamento | outro
  primary_rule_id: string | null;
  candidate_rule_ids: string[]; // top 3, ordered best→worst
  exclusion_term_id: string | null;
  patient_dependent_id: string | null;
  confidence: Confidence;
  reasoning: string;
};

// ── Engine output ────────────────────────────────────────────────────────────

export type EligibilityDetail = {
  category_match: {
    ai_category: string;
    ai_confidence: Confidence;
    ai_reasoning: string;
    candidate_rule_ids: string[];
    patient_dependent_id: string | null;
    exclusion_term_id: string | null;
  };
  applied_rule: {
    id: string;
    section: string | null;
    benefit_name: string | null;
    coverage_basis: string | null;
    source_quote: string | null;
  } | null;
  calculation: {
    gross_amount: number;
    coverage_pct: number | null;
    cap_per_event: number | null;
    multiple_value: number | null;
    multiple_count: number | null;
    computed_before_cap: number;
    computed_after_cap: number;
    annual_limit_amount: number | null;
    annual_used_before: number;
    annual_remaining: number | null;
    final_eligible: number;
    currency: string | null;
  };
  gates: GateResult[];
  deadline_date: string | null; // YYYY-MM-DD
  ai_model_used: string | null;
  determined_at: string; // ISO
};

export type EngineResult = {
  eligibility: Eligibility;
  eligible_amount: number;
  applied_rule_id: string | null;
  reasoning: string; // short PT-BR prose, 1-3 sentences
  confidence: Confidence;
  determined_by: "ai" | "manual";
  annual_used_before: number;
  deadline_date: string | null;
  eligibility_detail: EligibilityDetail;
};
