import { NextResponse } from "next/server";
import { requireAnyHealthRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/health/queue
// Claims that have been emailed to Celina, grouped by lifecycle stage.
// Accessible to admin, health, and secretary roles.
// Amounts are intentionally omitted — Celina does not need financial data.
export async function GET() {
  await requireAnyHealthRole();
  const sb = serverClient();

  const { data, error } = await sb
    .from("reimbursement_claims")
    .select(
      `id, lifecycle_state, sent_to_secretary_at, updated_at,
       nota_fiscais!inner(provider_name, patient_name, emission_date)`
    )
    .in("lifecycle_state", ["sent_to_secretary", "received_by_secretary", "sent_by_secretary"])
    .order("sent_to_secretary_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    lifecycle_state: string;
    sent_to_secretary_at: string | null;
    updated_at: string | null;
    nota_fiscais: {
      provider_name: string | null;
      patient_name: string | null;
      emission_date: string | null;
    } | { provider_name: string | null; patient_name: string | null; emission_date: string | null }[];
  };

  const claims = (data as Row[] | null ?? []).map((r) => {
    const nf = Array.isArray(r.nota_fiscais) ? r.nota_fiscais[0] : r.nota_fiscais;
    return {
      id: r.id,
      lifecycle_state: r.lifecycle_state,
      sent_to_secretary_at: r.sent_to_secretary_at,
      updated_at: r.updated_at,
      provider_name: nf?.provider_name ?? null,
      patient_name: nf?.patient_name ?? null,
      emission_date: nf?.emission_date ?? null,
    };
  });

  return NextResponse.json({ claims });
}
