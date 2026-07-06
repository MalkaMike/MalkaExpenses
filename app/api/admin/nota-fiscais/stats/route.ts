import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { fromDb } from "@/lib/money";

export const runtime = "nodejs";

// GET /api/admin/nota-fiscais/stats
// Aggregate stats: by category, by patient, match rate, reimbursable totals.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  // NF rows (paginated — 344 live and growing; PostgREST caps at 1000) and
  // the medical/education category ids are independent → parallel.
  type NfRow = {
    category_slug: string | null;
    is_medical: boolean | null;
    is_reimbursable: boolean | null;
    match_confidence: string | null;
    total_amount: number | null;
    patient_name: string | null;
    source_type: string | null;
    transaction_id: string | null;
    no_match_reason: string | null;
    payment_status: string | null;
    amount_paid: number | null;
    amount_pending: number | null;
  };
  async function loadAllNfs() {
    const out: NfRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await sb
        .from("nota_fiscais")
        .select("category_slug, is_medical, is_reimbursable, match_confidence, total_amount, patient_name, source_type, transaction_id, no_match_reason, payment_status, amount_paid, amount_pending")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((page ?? []) as NfRow[]));
      if (!page || page.length < PAGE) break;
    }
    return out;
  }

  const [all, medCatsRes] = await Promise.all([
    loadAllNfs(),
    sb.from("categories").select("id").in("slug", ["saude", "educacao"])
  ]);

  type Bucket = { count: number; total: number };
  const byCategory: Record<string, Bucket> = {};
  const byPatient: Record<string, Bucket> = {};
  let matched = 0;
  let reimbursableTotal = 0;
  let reimbursableCount = 0;
  let unmatchedPending = 0;

  for (const r of all) {
    const cat = r.category_slug ?? "outros";
    byCategory[cat] = byCategory[cat] ?? { count: 0, total: 0 };
    byCategory[cat].count++;
    byCategory[cat].total += Number(r.total_amount ?? 0);

    if (r.match_confidence && r.match_confidence !== "none") matched++;

    if (!r.transaction_id && !r.no_match_reason) unmatchedPending++;

    if (r.is_reimbursable) {
      reimbursableTotal += Number(r.total_amount ?? 0);
      reimbursableCount++;
    }

    const patient = r.patient_name ?? "Mickael";
    byPatient[patient] = byPatient[patient] ?? { count: 0, total: 0 };
    byPatient[patient].count++;
    byPatient[patient].total += Number(r.total_amount ?? 0);
  }

  const grandTotal = all.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  // Reimbursement by payment status (installment-aware)
  const reimb = all.filter((r) => r.is_reimbursable);
  const payAgg: Record<string, { count: number; face: number; paid: number; pending: number }> = {};
  for (const r of reimb) {
    const st = r.payment_status ?? "no_proof";
    payAgg[st] = payAgg[st] ?? { count: 0, face: 0, paid: 0, pending: 0 };
    payAgg[st].count++;
    payAgg[st].face += Number(r.total_amount ?? 0);
    payAgg[st].paid += Number(r.amount_paid ?? 0);
    payAgg[st].pending += Number(r.amount_pending ?? 0);
  }

  // Transactions matched by NFs — transaction_id is already in the first
  // fetch's select list; the old code re-queried the same table for it.
  const linkedSet = new Set(all.map((r) => r.transaction_id).filter(Boolean));

  const medCatIds = (medCatsRes.data ?? []).map((r) => r.id);

  // Transactions in medical/education categories NOT already linked to a NF
  const { data: unlinkedTxs } = await sb
    .from("transactions")
    .select("id, date, description_clean, real_amount")
    .in("category_id", medCatIds)
    .eq("is_fake", false)
    .lt("real_amount", 0)  // expenses only
    .limit(100);

  const missingNfs = (unlinkedTxs ?? []).filter((tx) => !linkedSet.has(tx.id));

  return NextResponse.json({
    total: all.length,
    grand_total: grandTotal,
    matched,
    unmatched: all.length - matched,
    match_rate: all.length > 0 ? Math.round((matched / all.length) * 100) : 0,
    reimbursable_count: reimbursableCount,
    reimbursable_total: reimbursableTotal,
    by_category: Object.entries(byCategory)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([slug, s]) => ({ slug, ...s })),
    by_patient: Object.entries(byPatient)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, s]) => ({ name, ...s })),
    missing_nfs: missingNfs.slice(0, 20).map((tx) => ({
      transaction_id: tx.id,
      date: tx.date,
      description: tx.description_clean,
      amount: Math.abs(fromDb(Number(tx.real_amount))),
    })),
    missing_nf_count: missingNfs.length,
    unmatched_pending: unmatchedPending,
    reimbursement_by_status: payAgg,
  });
}
