import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/health/policy
// The safe — the active health policy with its members, coverage rules and
// terms, each carrying its verbatim source_quote. Read-only reference data:
// the eligibility engine consumes these rules directly (no confirmation gate).
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const { data: policies, error } = await sb
    .from("insurance_policies")
    .select(
      `id, insurer_name, plan_name, plan_tier, policy_number, policy_type,
       holder_name, currency, cover_zone, overall_annual_limit, deductible_text,
       reimbursement_iban_last4, reimbursement_bank,
       intermediary_name, intermediary_email, intermediary_phone,
       claim_filing_limit, status, ai_extracted, extraction_confidence,
       policy_dependents(*),
       policy_coverage_rules(*),
       policy_terms(*),
       policy_documents(id, doc_type, file_name, byte_size, created_at)`
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policy: policies?.[0] ?? null });
}
