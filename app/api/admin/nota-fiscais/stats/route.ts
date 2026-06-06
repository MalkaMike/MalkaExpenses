import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/nota-fiscais/stats
// Aggregate stats: by category, by patient, match rate, reimbursable totals.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const { data: rows } = await sb
    .from("nota_fiscais")
    .select("category_slug, is_medical, is_reimbursable, match_confidence, total_amount, patient_name, source_type");

  const all = rows ?? [];

  type Bucket = { count: number; total: number };
  const byCategory: Record<string, Bucket> = {};
  const byPatient: Record<string, Bucket> = {};
  let matched = 0;
  let reimbursableTotal = 0;
  let reimbursableCount = 0;

  for (const r of all) {
    const cat = r.category_slug ?? "outros";
    byCategory[cat] = byCategory[cat] ?? { count: 0, total: 0 };
    byCategory[cat].count++;
    byCategory[cat].total += Number(r.total_amount ?? 0);

    if (r.match_confidence && r.match_confidence !== "none") matched++;

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

  // Transactions matched by NFs (IDs already linked in nota_fiscais.transaction_id)
  const { data: linkedTxIds } = await sb
    .from("nota_fiscais")
    .select("transaction_id")
    .not("transaction_id", "is", null);

  const linkedSet = new Set((linkedTxIds ?? []).map((r) => r.transaction_id));

  // Medical/education category IDs
  const { data: medCats } = await sb
    .from("categories")
    .select("id")
    .in("slug", ["saude", "educacao"]);
  const medCatIds = (medCats ?? []).map((r) => r.id);

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
      amount: Math.abs(Number(tx.real_amount)),
    })),
    missing_nf_count: missingNfs.length,
  });
}
