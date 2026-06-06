import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/health/policies
// List policies with dependent + rule counts.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const { data: policies, error } = await sb
    .from("insurance_policies")
    .select("*, policy_dependents(count), policy_coverage_rules(count)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policies: policies ?? [] });
}

// POST /api/admin/health/policies
// Persist a reviewed extraction. Body: { policy, dependents, coverage_rules, source_file_name }
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: {
    policy?: Record<string, unknown>;
    dependents?: Record<string, unknown>[];
    coverage_rules?: Record<string, unknown>[];
    source_file_name?: string;
    raw_text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { policy, dependents = [], coverage_rules = [], source_file_name, raw_text } = body;
  if (!policy || !policy.insurer_name) {
    return NextResponse.json({ error: "policy.insurer_name required" }, { status: 400 });
  }

  const sb = serverClient();

  const policyRow = {
    insurer_name: policy.insurer_name,
    plan_name: policy.plan_name ?? null,
    policy_number: policy.policy_number ?? null,
    policy_type: policy.policy_type ?? "saude",
    holder_name: policy.holder_name ?? null,
    holder_cpf: policy.holder_cpf ?? null,
    reimbursement_model: policy.reimbursement_model ?? null,
    annual_ceiling: policy.annual_ceiling ?? null,
    effective_from: policy.effective_from ?? null,
    effective_to: policy.effective_to ?? null,
    source_file_path: source_file_name ?? null,
    raw_text: raw_text ?? null,
    ai_extracted: true,
    extraction_confidence: policy.extraction_confidence ?? null,
    status: "active",
  };

  const { data: inserted, error: pErr } = await sb
    .from("insurance_policies")
    .insert(policyRow)
    .select("id")
    .single();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const policyId = inserted.id;

  if (dependents.length > 0) {
    const depRows = dependents.map((d) => ({
      policy_id: policyId,
      name: d.name,
      cpf: d.cpf ?? null,
      relationship: d.relationship ?? null,
      birth_date: d.birth_date ?? null,
    }));
    const { error: dErr } = await sb.from("policy_dependents").insert(depRows);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  }

  if (coverage_rules.length > 0) {
    const ruleRows = coverage_rules.map((r) => ({
      policy_id: policyId,
      category: r.category,
      procedure_keywords: r.procedure_keywords ?? null,
      reimbursement_pct: r.reimbursement_pct ?? null,
      reimbursement_cap: r.reimbursement_cap ?? null,
      multiple_value: r.multiple_value ?? null,
      multiple_count: r.multiple_count ?? null,
      annual_limit_amount: r.annual_limit_amount ?? null,
      annual_limit_count: r.annual_limit_count ?? null,
      limit_period: r.limit_period ?? null,
      waiting_period_days: r.waiting_period_days ?? null,
      requires_prescription: r.requires_prescription ?? false,
      requires_report: r.requires_report ?? false,
      source_quote: r.source_quote ?? null,
      notes: r.notes ?? null,
    }));
    const { error: rErr } = await sb.from("policy_coverage_rules").insert(ruleRows);
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: policyId, saved: true });
}
