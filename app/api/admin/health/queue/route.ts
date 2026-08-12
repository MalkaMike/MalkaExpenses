import { NextResponse } from "next/server";
import { requireAnyHealthRole, getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import {
  resolvePatient,
  extractCouncilId,
  extractDoctorName,
  claimGaps,
  type NfLike
} from "@/lib/health/claim-info";
import { isClaimState, type ClaimState } from "@/lib/health/claim-status";
import { guidanceFor, insurerFor } from "@/lib/health/claim-guidance";

export const runtime = "nodejs";

// GET /api/admin/health/queue
//
// Every medical invoice, with everything needed to file the claim. Accessible
// to admin, health, and secretary.
//
// Reads `nota_fiscais` directly rather than `reimbursement_claims`: only 2
// claim rows exist against 33 medical invoices, so the old claims-only query
// showed the secretary an empty page while R$ 71k sat unclaimed.
//
// Amounts ARE included. The previous version omitted them by design
// ("Celina does not need financial data"); reversed deliberately — without the
// value she cannot check what the insurer paid back or prioritise by size.
export async function GET() {
  await requireAnyHealthRole();
  const role = await getRole();
  const sb = serverClient();

  const [nfRes, rosterRes, providersRes] = await Promise.all([
    sb
      .from("nota_fiscais")
      .select(
        `id, nf_number, emission_date, provider_name, provider_cnpj_formatted,
         provider_cnpj, patient_name, recipient_name, service_description,
         total_amount, storage_path, transaction_id,
         reimbursement_status, reimbursement_amount, reimbursement_submitted_at,
         reimbursement_notes`
      )
      .eq("is_medical", true)
      .order("emission_date", { ascending: false }),
    sb.from("policy_dependents").select("name, relationship"),
    sb.from("family_providers").select("full_name, specialty, phone, clinic")
  ]);

  if (nfRes.error) {
    return NextResponse.json({ error: nfRes.error.message }, { status: 500 });
  }
  // The roster only sharpens name matching, and the provider list only adds
  // specialty — neither is worth failing the whole page over, but a silent
  // degradation would be invisible, so it is reported alongside the data.
  const warnings: string[] = [];
  if (rosterRes.error) warnings.push(`lista de dependentes indisponível: ${rosterRes.error.message}`);
  if (providersRes.error) warnings.push(`lista de médicos indisponível: ${providersRes.error.message}`);

  const roster = (rosterRes.data ?? []).map((d) => d.name as string).filter(Boolean);
  const specialtyByName = new Map<string, { specialty: string | null; clinic: string | null; phone: string | null }>();
  for (const p of providersRes.data ?? []) {
    if (p.full_name) {
      specialtyByName.set((p.full_name as string).toUpperCase(), {
        specialty: (p.specialty as string) ?? null,
        clinic: (p.clinic as string) ?? null,
        phone: (p.phone as string) ?? null
      });
    }
  }

  const claims = (nfRes.data ?? []).map((row) => {
    const nf = row as unknown as NfLike & {
      id: string;
      nf_number: string | null;
      emission_date: string | null;
      provider_cnpj_formatted: string | null;
      total_amount: string | number | null;
      transaction_id: string | null;
      reimbursement_status: string | null;
      reimbursement_amount: string | number | null;
      reimbursement_submitted_at: string | null;
      reimbursement_notes: string | null;
    };

    const patient = resolvePatient(nf, roster);
    const council = extractCouncilId(nf.service_description);
    const known = specialtyByName.get((nf.provider_name ?? "").toUpperCase());
    const state: ClaimState = isClaimState(nf.reimbursement_status)
      ? nf.reimbursement_status
      : "not_submitted";

    return {
      id: nf.id,
      nfNumber: nf.nf_number,
      emissionDate: nf.emission_date ? nf.emission_date.slice(0, 10) : null,
      providerName: nf.provider_name,
      cnpj: nf.provider_cnpj_formatted ?? nf.provider_cnpj,
      // The doctor named in the invoice text; when the provider is itself a
      // known individual practitioner (not a billing company), that name is
      // the doctor and serves as the fallback.
      doctorName: extractDoctorName(nf.service_description) ?? (known ? nf.provider_name : null),
      council,
      specialty: known?.specialty ?? null,
      clinic: known?.clinic ?? null,
      phone: known?.phone ?? null,
      patient: patient.name || null,
      patientSource: patient.source,
      patientConfirmed: patient.confirmed,
      // total_amount is numeric REAIS on this table (not cents like
      // transactions.real_amount) — do not run it through fromDb().
      amount: nf.total_amount == null ? null : Number(nf.total_amount),
      serviceDescription: nf.service_description,
      hasPdf: !!nf.storage_path,
      matchedPayment: !!nf.transaction_id,
      state,
      reimbursedAmount: nf.reimbursement_amount == null ? null : Number(nf.reimbursement_amount),
      submittedAt: nf.reimbursement_submitted_at,
      notes: nf.reimbursement_notes,
      gaps: claimGaps(nf, patient),
      // What to ask this provider for, and whose job it is. Also which insurer
      // the treatment date falls under — sending a pre-25/02/2026 invoice to
      // APRIL, or phoning a 2025 provider "for APRIL", is a wasted trip.
      guidance: guidanceFor(nf.provider_name, nf.nf_number),
      insurer: insurerFor(nf.emission_date)
    };
  });

  // The secretary's queue is her to-do list, so it carries only her work.
  // Invoices Mickael kept for himself, and the ones frozen pending the broker,
  // are filtered out server-side rather than merely greyed out — a task she
  // must not start does not belong on the list at all. Admin/health see all.
  const visible =
    role === "secretary" ? claims.filter((c) => c.guidance.owner === "secretary") : claims;

  return NextResponse.json({
    claims: visible,
    warnings,
    hiddenFromSecretary: role === "secretary" ? claims.length - visible.length : 0
  });
}
