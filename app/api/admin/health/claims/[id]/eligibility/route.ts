import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { determineEligibility } from "@/lib/eligibility/engine";
import type {
  CoverageRule,
  Dependent,
  EligibilityNf,
  EligibilityPolicy,
  EngineInput,
  MedicalDocument,
  PolicyTerm,
  PriorClaim,
} from "@/lib/eligibility/types";

export const runtime = "nodejs";
// Gemini 2.5 Pro call ~10-25s + DB round-trips; keep generous headroom.
export const maxDuration = 60;

// ============================================================================
// Per-claim eligibility:
//   POST /api/admin/health/claims/[id]/eligibility   — run the engine + persist
//   GET  /api/admin/health/claims/[id]/eligibility   — fetch the cached result
//
// [id] = nota_fiscais.id. The route upserts the reimbursement_claims row keyed
// on nota_fiscal_id; it never creates parallel claim records.
//
// Honesty: a row with manually_confirmed_at set is locked. POST refuses to
// overwrite unless body { force: true } is passed AND a reason is supplied.
// ============================================================================

type Params = { params: Promise<{ id: string }> };

async function fetchEngineInput(nfId: string) {
  const sb = serverClient();

  // The NF + its payment rollup (already on nota_fiscais after migration 0017).
  const { data: nfRow, error: nfErr } = await sb
    .from("nota_fiscais")
    .select(
      `id, provider_name, service_description, total_amount, emission_date,
       patient_name, is_medical, is_reimbursable,
       payment_status, amount_paid, amount_pending`
    )
    .eq("id", nfId)
    .maybeSingle();
  if (nfErr) throw new Error(`nota_fiscais: ${nfErr.message}`);
  if (!nfRow) throw new Error("not_found");
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

  // Active policy (Premium / Zone 2 / EUR — exactly one for this user).
  const { data: policies, error: polErr } = await sb
    .from("insurance_policies")
    .select(
      `id, insurer_name, plan_tier, cover_zone, currency,
       overall_annual_limit, deductible_text, claim_filing_limit,
       human_confirmed, effective_from`
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  if (polErr) throw new Error(`insurance_policies: ${polErr.message}`);
  const polRow = policies?.[0];
  if (!polRow) throw new Error("no_active_policy");
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

  // Coverage rules + terms + dependents for this policy.
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
    sb
      .from("policy_terms")
      .select("*")
      .eq("policy_id", policy.id),
    sb
      .from("policy_dependents")
      .select("id, name, relationship, birth_date")
      .eq("policy_id", policy.id),
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

  // Prescription (joined via existing reimbursement_claims row, if any).
  const { data: existingClaim } = await sb
    .from("reimbursement_claims")
    .select("id, prescription_id, manually_confirmed_at, medical_documents(*)")
    .eq("nota_fiscal_id", nfId)
    .maybeSingle();
  type ClaimWithDoc = {
    id: string;
    prescription_id: string | null;
    manually_confirmed_at: string | null;
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

  // Prior eligible claims for annual-limit math (same patient bucket, any prior NFs).
  // For v1 we don't have per-patient routing yet — count ALL prior eligible/partial claims
  // under the same applied_rule_id within the same calendar year. The engine filters by ruleId.
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

  const input: EngineInput = { nf, policy, rules, terms, dependents, prescription, prior_claims };
  return { input, existing_claim_id: ec?.id ?? null, manually_confirmed: !!ec?.manually_confirmed_at };
}

// ── POST: run engine + upsert ────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  await requireAdmin();
  const { id } = await params;

  let body: { force?: boolean; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body OK
  }

  let prepared;
  try {
    prepared = await fetchEngineInput(id);
  } catch (e) {
    const msg = (e as Error).message;
    const code = msg === "not_found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }

  if (prepared.manually_confirmed && !body.force) {
    return NextResponse.json(
      { error: "manually_confirmed", message: "Esta determinação foi confirmada manualmente. Use {force: true, reason: '…'} para sobrescrever." },
      { status: 409 }
    );
  }

  const result = await determineEligibility(prepared.input);

  const sb = serverClient();
  const upsertRow = {
    nota_fiscal_id: id,
    policy_id: prepared.input.policy.id,
    patient_name: prepared.input.nf.patient_name,
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
  };

  const { data: saved, error: saveErr } = await sb
    .from("reimbursement_claims")
    .upsert(upsertRow, { onConflict: "nota_fiscal_id" })
    .select("id, nota_fiscal_id")
    .single();
  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ...saved, ...result });
}

// ── GET: read cached row ─────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  await requireAdmin();
  const { id } = await params;

  const sb = serverClient();
  const { data, error } = await sb
    .from("reimbursement_claims")
    .select("*")
    .eq("nota_fiscal_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ claim: null });
  return NextResponse.json({ claim: data });
}

// ── PATCH: manual confirm / override ─────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  await requireAdmin();
  const { id } = await params;

  let body: {
    eligibility?: string;
    eligible_amount?: number;
    applied_rule_id?: string | null;
    reasoning?: string;
    manually_confirmed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const sb = serverClient();
  const update: Record<string, unknown> = {};
  if (body.eligibility) update.eligibility = body.eligibility;
  if (typeof body.eligible_amount === "number") update.eligible_amount = body.eligible_amount;
  if (body.applied_rule_id !== undefined) update.applied_rule_id = body.applied_rule_id;
  if (body.reasoning !== undefined) update.reasoning = body.reasoning;
  if (body.manually_confirmed) {
    update.manually_confirmed_at = new Date().toISOString();
    update.determined_by = "manual";
    update.confidence = "high";
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("reimbursement_claims")
    .update(update)
    .eq("nota_fiscal_id", id)
    .select("id, nota_fiscal_id, eligibility, eligible_amount, manually_confirmed_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
