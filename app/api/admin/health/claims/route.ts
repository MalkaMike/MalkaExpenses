import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/health/claims
// The reimbursement command center: every medical nota with its 3-part
// readiness — bank payment, NF/recibo, prescription — plus a summary.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const { data, error } = await sb
    .from("nota_fiscais")
    .select(
      `id, provider_name, patient_name, total_amount, emission_date, category_slug,
       payment_status, installments_total, installments_paid, amount_paid, amount_pending,
       reimbursement_claims(prescription_id, eligibility, eligible_amount)`
    )
    .eq("is_reimbursable", true)
    .order("emission_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    provider_name: string | null;
    patient_name: string | null;
    total_amount: number | null;
    emission_date: string | null;
    category_slug: string | null;
    payment_status: string | null;
    installments_total: number | null;
    installments_paid: number | null;
    amount_paid: number | null;
    amount_pending: number | null;
    reimbursement_claims?: {
      prescription_id: string | null;
      eligibility: string | null;
      eligible_amount: number | null;
    }[];
  };

  const claims = (data as Row[] | null ?? []).map((r) => {
    const claim = r.reimbursement_claims?.[0];
    const hasPayment = r.payment_status === "paid_full" || r.payment_status === "paying";
    const hasPrescription = !!claim?.prescription_id;
    const hasFiscalDoc = true; // the nota IS the fiscal doc (NF/recibo)
    const complete = hasPayment && hasPrescription && hasFiscalDoc;
    let readiness: string;
    if (complete) readiness = "complete";
    else if (!hasPrescription && hasPayment) readiness = "needs_prescription";
    else if (!hasPayment && hasPrescription) readiness = "needs_payment";
    else readiness = "needs_both";
    const { reimbursement_claims, ...rest } = r;
    void reimbursement_claims;
    return {
      ...rest,
      has_payment: hasPayment,
      has_prescription: hasPrescription,
      has_fiscal_doc: hasFiscalDoc,
      readiness,
      eligibility: claim?.eligibility ?? null,
      eligible_amount: claim?.eligible_amount ?? null,
    };
  });

  const n = (k: string) => claims.filter((c) => c.readiness === k).length;
  const sum = (arr: typeof claims) => arr.reduce((s, c) => s + Number(c.total_amount ?? 0), 0);

  return NextResponse.json({
    claims,
    summary: {
      total: claims.length,
      total_value: sum(claims),
      complete: n("complete"),
      complete_value: sum(claims.filter((c) => c.readiness === "complete")),
      needs_prescription: n("needs_prescription"),
      needs_payment: n("needs_payment"),
      needs_both: n("needs_both"),
    },
  });
}
