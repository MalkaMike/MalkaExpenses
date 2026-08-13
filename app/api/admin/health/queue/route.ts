import { NextResponse } from "next/server";
import { requireAnyHealthRole, getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import {
  resolvePatient,
  extractCouncilId,
  extractDoctorName,
  claimGaps,
  claimDeadline,
  type NfLike
} from "@/lib/health/claim-info";
import { isClaimState, type ClaimState } from "@/lib/health/claim-status";
import { guidanceFor, insurerFor, askSteps } from "@/lib/health/claim-guidance";

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
         total_amount, storage_path, storage_bucket, transaction_id,
         reimbursement_status, reimbursement_amount, reimbursement_submitted_at,
         reimbursement_notes`
      )
      .eq("is_medical", true)
      .order("emission_date", { ascending: false }),
    sb.from("policy_dependents").select("name, relationship"),
    sb.from("family_providers").select("cnpj, full_name, specialty, phone, whatsapp, clinic, address, notes, confidence")
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
  type Contact = {
    fullName: string | null;
    specialty: string | null;
    clinic: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    contactNotes: string | null;
    contactConfidence: string | null;
  };

  // Two lookups. CNPJ is the real key: an invoice carries the billing entity's
  // legal name ("SOCIEDADE BENEF ISRAELITABRAS...") and never the doctor's, so
  // matching on the name failed on nearly every row and the secretary saw "sem
  // telefone cadastrado" for the one task she has. Name stays as the fallback
  // for practitioners who bill personally.
  const byCnpj = new Map<string, Contact>();
  const byName = new Map<string, Contact>();
  const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

  for (const p of providersRes.data ?? []) {
    const contact: Contact = {
      fullName: (p.full_name as string) ?? null,
      specialty: (p.specialty as string) ?? null,
      clinic: (p.clinic as string) ?? null,
      phone: (p.phone as string) ?? null,
      whatsapp: (p.whatsapp as string) ?? null,
      address: (p.address as string) ?? null,
      contactNotes: (p.notes as string) ?? null,
      contactConfidence: (p.confidence as string) ?? null
    };
    if (p.cnpj) byCnpj.set(digits(p.cnpj as string), contact);
    if (p.full_name) byName.set((p.full_name as string).toUpperCase(), contact);
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
      storage_bucket: string | null;
    };

    const patient = resolvePatient(nf, roster);
    const council = extractCouncilId(nf.service_description);
    const known =
      byCnpj.get(digits(nf.provider_cnpj)) ??
      byName.get((nf.provider_name ?? "").toUpperCase());
    const state: ClaimState = isClaimState(nf.reimbursement_status)
      ? nf.reimbursement_status
      : "not_submitted";

    return {
      id: nf.id,
      nfNumber: nf.nf_number,
      emissionDate: nf.emission_date ? nf.emission_date.slice(0, 10) : null,
      providerName: nf.provider_name,
      cnpj: nf.provider_cnpj_formatted ?? nf.provider_cnpj,
      // The doctor named in the invoice text. The fallback to provider_name
      // only holds when the provider IS the practitioner — i.e. the contact we
      // matched carries that very name. Falling back whenever a contact existed
      // turned "SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN" into a
      // doctor's name on a card that also said the invoice names no doctor.
      doctorName:
        extractDoctorName(nf.service_description) ??
        (known?.fullName &&
        known.fullName.toUpperCase() === (nf.provider_name ?? "").toUpperCase()
          ? nf.provider_name
          : null),
      // Who answers for the provider, when that is somebody other than the
      // treating doctor (a clinic's technical director, for instance).
      contactPerson:
        known?.fullName &&
        known.fullName.toUpperCase() !== (nf.provider_name ?? "").toUpperCase()
          ? known.fullName
          : null,
      council,
      specialty: known?.specialty ?? null,
      clinic: known?.clinic ?? null,
      phone: known?.phone ?? null,
      whatsapp: known?.whatsapp ?? null,
      providerAddress: known?.address ?? null,
      contactNotes: known?.contactNotes ?? null,
      // 'probable'/'unconfirmed' means nobody has dialled it. The UI says so
      // rather than presenting a web-search result as a verified number.
      contactConfidence: known?.contactConfidence ?? null,
      patient: patient.name || null,
      patientSource: patient.source,
      patientConfirmed: patient.confirmed,
      // total_amount is numeric REAIS on this table (not cents like
      // transactions.real_amount) — do not run it through fromDb().
      amount: nf.total_amount == null ? null : Number(nf.total_amount),
      serviceDescription: nf.service_description,
      // BOTH columns, because the PDF route needs both — with only a path it
      // falls back to reading local disk, which does not exist in production.
      // A button that promises a file it cannot serve is worse than no button.
      hasPdf: !!(nf.storage_bucket && nf.storage_path),
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
      steps: askSteps(guidanceFor(nf.provider_name, nf.nf_number)),
      insurer: insurerFor(nf.emission_date),
      // Two years from the service date. The Bradesco-era invoices are the
      // OLDEST, so they die first — the opposite of the order their value
      // suggests, and invisible without this.
      deadline: claimDeadline(nf.emission_date)
    };
  });

  // The secretary's queue is her to-do list, so it carries only her work.
  // Invoices Mickael kept for himself, and the ones frozen pending the broker,
  // are filtered out server-side rather than merely greyed out — a task she
  // must not start does not belong on the list at all. Admin/health see all.
  const visible =
    role === "secretary" ? claims.filter((c) => c.guidance.owner === "secretary") : claims;

  // How many documents are already collected per claim — the single fact that
  // answers "where did I stop?" without opening every card.
  //
  // ONE query against the storage metadata (view `claim_attachment_counts`).
  // The first version listed the bucket once per claim, ~23 parallel calls from
  // a serverless function; it worked in dev and returned nothing in production,
  // so every row showed "?" and both document filters counted zero.
  const counts = new Map<string, number>();
  let countsFailed: string | null = null;
  const countRes = await sb
    .from("claim_attachment_counts")
    .select("nota_fiscal_id, attachment_count");
  if (countRes.error) {
    countsFailed = countRes.error.message;
    // "Unknown" must never render as "zero documents" — that would send her to
    // re-collect paperwork she already has. The message goes with it, so the
    // next person does not have to guess like I did.
    warnings.push(`não consegui contar os documentos guardados: ${countsFailed}`);
  } else {
    for (const row of countRes.data ?? []) {
      counts.set(row.nota_fiscal_id as string, Number(row.attachment_count));
    }
  }

  // Which request steps are already ticked, for every claim, in one query.
  const stepsDone = new Map<string, number[]>();
  const doneRes = await sb.from("claim_steps").select("nota_fiscal_id, step_index");
  if (doneRes.error) {
    warnings.push(`não consegui ler os passos já feitos: ${doneRes.error.message}`);
  } else {
    for (const row of doneRes.data ?? []) {
      const id = row.nota_fiscal_id as string;
      const list = stepsDone.get(id) ?? [];
      list.push(Number(row.step_index));
      stepsDone.set(id, list);
    }
  }

  return NextResponse.json({
    // A claim absent from the view genuinely has no documents — that is 0, not
    // unknown. Only a failed query makes the count unknowable.
    claims: visible.map((c) => ({
      ...c,
      attachmentCount: countsFailed ? null : counts.get(c.id) ?? 0,
      stepsDone: stepsDone.get(c.id) ?? []
    })),
    warnings,
    hiddenFromSecretary: role === "secretary" ? claims.length - visible.length : 0
  });
}
