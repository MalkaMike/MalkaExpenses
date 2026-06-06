import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { determineEligibility } from "./engine";
import type {
  CoverageRule,
  Dependent,
  EligibilityNf,
  EligibilityPolicy,
  EngineInput,
  MedicalDocument,
  PolicyTerm,
  PriorClaim,
} from "./types";

// ============================================================================
// Reusable recompute helpers — called both by the per-claim API route and by
// background triggers (rule confirmed, prescription attached, NF imported).
//
// Honors the manual-confirm lock: rows with manually_confirmed_at set are
// skipped unless explicitly forced.
// ============================================================================

type RecomputeOpts = {
  force?: boolean; // override manually_confirmed_at lock
};

export async function recomputeOne(nfId: string, opts: RecomputeOpts = {}): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  const sb = serverClient();

  // Skip if locked and not forced.
  if (!opts.force) {
    const { data: existing } = await sb
      .from("reimbursement_claims")
      .select("manually_confirmed_at")
      .eq("nota_fiscal_id", nfId)
      .maybeSingle();
    if (existing?.manually_confirmed_at) {
      return { ok: false, skipped: "manually_confirmed" };
    }
  }

  const input = await loadEngineInput(nfId);
  if (!input) return { ok: false, error: "not_found_or_no_policy" };

  try {
    const result = await determineEligibility(input);
    await sb
      .from("reimbursement_claims")
      .upsert(
        {
          nota_fiscal_id: nfId,
          policy_id: input.policy.id,
          patient_name: input.nf.patient_name,
          eligibility: result.eligibility,
          eligible_amount: result.eligible_amount,
          applied_rule_id: result.applied_rule_id,
          reasoning: result.reasoning,
          confidence: result.confidence,
          determined_by: result.determined_by,
          annual_used_before: result.annual_used_before,
          deadline_date: result.deadline_date,
          eligibility_detail: result.eligibility_detail,
          eligibility_determined_at: result.eligibility_detail.determined_at,
          ai_model_used: result.eligibility_detail.ai_model_used,
        },
        { onConflict: "nota_fiscal_id" }
      );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Fire-and-forget recompute for every AI-determined claim using a given rule.
// Used after a policy rule is human-confirmed (user trusts the rule, so trust
// the verdicts that depend on it — but never overwrite manual rows).
export function recomputeForRuleInBackground(ruleId: string): void {
  void (async () => {
    try {
      const sb = serverClient();
      const { data, error } = await sb
        .from("reimbursement_claims")
        .select("nota_fiscal_id")
        .eq("applied_rule_id", ruleId)
        .eq("determined_by", "ai")
        .is("manually_confirmed_at", null);
      if (error) {
        console.error("[recompute-for-rule] list error:", error.message);
        return;
      }
      const ids = (data ?? []).map((r) => r.nota_fiscal_id as string);
      // Sequential to respect Gemini RPM limits — bounded by the small claim count here.
      for (const id of ids) {
        const r = await recomputeOne(id);
        if (!r.ok) console.warn(`[recompute-for-rule] ${id}: ${r.error ?? r.skipped}`);
      }
    } catch (e) {
      console.error("[recompute-for-rule] fatal:", (e as Error).message);
    }
  })();
}

// Same shape as the engine input — kept in one place so the API route and
// the background trigger see identical data.
async function loadEngineInput(nfId: string): Promise<EngineInput | null> {
  const sb = serverClient();

  const { data: nfRow } = await sb
    .from("nota_fiscais")
    .select(
      `id, provider_name, service_description, total_amount, emission_date,
       patient_name, is_medical, is_reimbursable,
       payment_status, amount_paid, amount_pending`
    )
    .eq("id", nfId)
    .maybeSingle();
  if (!nfRow) return null;

  const { data: policies } = await sb
    .from("insurance_policies")
    .select(
      `id, insurer_name, plan_tier, cover_zone, currency,
       overall_annual_limit, deductible_text, claim_filing_limit,
       human_confirmed, effective_from`
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  const polRow = policies?.[0];
  if (!polRow) return null;

  const nf: EligibilityNf = {
    id: nfRow.id,
    provider_name: nfRow.provider_name,
    service_description: nfRow.service_description,
    total_amount: Number(nfRow.total_amount ?? 0),
    emission_date: String(nfRow.emission_date ?? "").slice(0, 10),
    patient_name: nfRow.patient_name,
    is_medical: !!nfRow.is_medical,
    is_reimbursable: !!nfRow.is_reimbursable,
    payment_status: nfRow.payment_status,
    amount_paid: nfRow.amount_paid != null ? Number(nfRow.amount_paid) : null,
    amount_pending: nfRow.amount_pending != null ? Number(nfRow.amount_pending) : null,
  };
  const policy: EligibilityPolicy = {
    id: polRow.id,
    insurer_name: polRow.insurer_name,
    plan_tier: polRow.plan_tier,
    cover_zone: polRow.cover_zone,
    currency: polRow.currency,
    overall_annual_limit: polRow.overall_annual_limit,
    deductible_text: polRow.deductible_text,
    claim_filing_limit: polRow.claim_filing_limit,
    human_confirmed: !!polRow.human_confirmed,
    effective_from: polRow.effective_from ?? null,
  };

  const [{ data: rulesRows }, { data: termRows }, { data: depRows }] = await Promise.all([
    sb
      .from("policy_coverage_rules")
      .select(
        `id, policy_id, section, benefit_name, category, coverage_basis, plan_tier,
         procedure_keywords, reimbursement_pct, reimbursement_cap,
         multiple_value, multiple_count, annual_limit_amount, annual_limit_count,
         limit_period, waiting_period_days, requires_preauth, requires_prescription,
         source_quote, notes, human_confirmed`
      )
      .eq("policy_id", policy.id),
    sb.from("policy_terms").select("*").eq("policy_id", policy.id),
    sb.from("policy_dependents").select("id, name, relationship, birth_date").eq("policy_id", policy.id),
  ]);
  const rules: CoverageRule[] = (rulesRows ?? []).map((r) => ({
    id: r.id,
    policy_id: r.policy_id,
    section: r.section,
    benefit_name: r.benefit_name,
    category: r.category,
    coverage_basis: r.coverage_basis,
    plan_tier: r.plan_tier,
    procedure_keywords: r.procedure_keywords,
    reimbursement_pct: r.reimbursement_pct != null ? Number(r.reimbursement_pct) : null,
    reimbursement_cap: r.reimbursement_cap != null ? Number(r.reimbursement_cap) : null,
    multiple_value: r.multiple_value != null ? Number(r.multiple_value) : null,
    multiple_count: r.multiple_count != null ? Number(r.multiple_count) : null,
    annual_limit_amount: r.annual_limit_amount != null ? Number(r.annual_limit_amount) : null,
    annual_limit_count: r.annual_limit_count,
    limit_period: r.limit_period,
    waiting_period_days: r.waiting_period_days,
    requires_preauth: !!r.requires_preauth,
    requires_prescription: !!r.requires_prescription,
    source_quote: r.source_quote,
    notes: r.notes,
    human_confirmed: !!r.human_confirmed,
  }));
  const terms: PolicyTerm[] = (termRows ?? []) as PolicyTerm[];
  const dependents: Dependent[] = (depRows ?? []) as Dependent[];

  const { data: existingClaim } = await sb
    .from("reimbursement_claims")
    .select("prescription_id, medical_documents(*)")
    .eq("nota_fiscal_id", nfId)
    .maybeSingle();
  type ClaimWithDoc = {
    prescription_id: string | null;
    medical_documents: MedicalDocument | MedicalDocument[] | null;
  };
  const ec = existingClaim as ClaimWithDoc | null;
  const prescriptionDoc = Array.isArray(ec?.medical_documents)
    ? ec?.medical_documents[0] ?? null
    : ec?.medical_documents ?? null;
  const prescription: MedicalDocument | null = prescriptionDoc
    ? {
        id: prescriptionDoc.id,
        doc_type: prescriptionDoc.doc_type,
        doctor_name: prescriptionDoc.doctor_name,
        doctor_crm: prescriptionDoc.doctor_crm,
        patient_name: prescriptionDoc.patient_name,
        issue_date: prescriptionDoc.issue_date,
        description: prescriptionDoc.description,
      }
    : null;

  const { data: priorRows } = await sb
    .from("reimbursement_claims")
    .select("applied_rule_id, eligible_amount, nota_fiscais(emission_date)")
    .neq("nota_fiscal_id", nfId)
    .in("eligibility", ["eligible", "partial"])
    .not("applied_rule_id", "is", null);
  type PriorRow = {
    applied_rule_id: string | null;
    eligible_amount: number | string | null;
    nota_fiscais: { emission_date: string | null } | { emission_date: string | null }[] | null;
  };
  const prior_claims: PriorClaim[] = ((priorRows ?? []) as PriorRow[]).map((p) => {
    const nfRel = Array.isArray(p.nota_fiscais) ? p.nota_fiscais[0] : p.nota_fiscais;
    return {
      rule_id: p.applied_rule_id,
      eligible_amount: p.eligible_amount != null ? Number(p.eligible_amount) : null,
      nf_emission_date: nfRel?.emission_date ? String(nfRel.emission_date).slice(0, 10) : null,
    };
  });

  return { nf, policy, rules, terms, dependents, prescription, prior_claims };
}
