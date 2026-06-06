import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

const QuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  patient: z.string().optional(),
  provider: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  is_medical: z.coerce.boolean().optional(),
  is_reimbursable: z.coerce.boolean().optional(),
  unmatched: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

// GET /api/admin/nota-fiscais
// Search + filter nota fiscais with pagination.
export async function GET(req: NextRequest) {
  await requireAdmin();

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }
  const { q, category, patient, provider, date_from, date_to,
          is_medical, is_reimbursable, unmatched, page, per_page } = parsed.data;

  const sb = serverClient();

  let query = sb
    .from("nota_fiscais")
    .select(
      `id, file_name, nf_number, emission_date, provider_name, provider_cnpj_formatted,
       patient_name, service_code, service_description, total_amount, category_slug,
       is_medical, is_reimbursable, match_confidence, transaction_id,
       reimbursement_status, verification_code, payment_date, source_type, no_match_reason,
       payment_status, installments_total, installments_paid, amount_paid, amount_pending`,
      { count: "exact" }
    )
    .order("emission_date", { ascending: false });

  if (category) query = query.eq("category_slug", category);
  if (is_medical !== undefined) query = query.eq("is_medical", is_medical);
  if (is_reimbursable !== undefined) query = query.eq("is_reimbursable", is_reimbursable);
  if (unmatched) query = query.is("transaction_id", null);
  if (date_from) query = query.gte("emission_date", date_from);
  if (date_to) query = query.lte("emission_date", date_to + "T23:59:59");
  if (patient) query = query.ilike("patient_name", `%${patient}%`);
  if (provider) query = query.ilike("provider_name", `%${provider}%`);

  // Full-text search on raw_text via Postgres tsvector (if q provided)
  if (q) {
    query = query.textSearch("raw_text", q, {
      type: "websearch",
      config: "portuguese",
    });
  }

  const from = (page - 1) * per_page;
  query = query.range(from, from + per_page - 1);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  });
}
