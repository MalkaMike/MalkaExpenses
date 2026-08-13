/**
 * What the secretary needs to know about one medical invoice.
 *
 * Pure functions, no I/O — the API layer fetches rows and the roster, this
 * decides what they mean. Kept free of `server-only` so the queue UI can reuse
 * the same labels the API computed.
 *
 * Background: `nota_fiscais` stores the doctor's name and council number inside
 * the free-text `service_description`, not in columns, and `patient_name` is
 * filled on barely a third of rows. The insurer rejects a claim naming the
 * wrong patient, so everything derived here carries how it was derived.
 */

export type PatientSource =
  | "field"
  | "description"
  | "recipient"
  | "unknown";

export type ResolvedPatient = {
  name: string;
  source: PatientSource;
  /** false = inferred. Must be shown as needing confirmation, never as fact. */
  confirmed: boolean;
};

export type CouncilId = {
  /** CRM (doctors), CRP (psychologists), CRO (dentists), etc. */
  council: string;
  number: string;
  /** State suffix when the invoice spells it out, e.g. "SP". */
  uf: string | null;
};

export type NfLike = {
  patient_name: string | null;
  recipient_name: string | null;
  service_description: string | null;
  provider_name: string | null;
  provider_cnpj: string | null;
  storage_path: string | null;
};

// "Paciente: NOME" / "Nome do paciente: NOME"
const RE_PATIENT_LABEL =
  /paciente\s*[:\-]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s']{2,60})/i;

// "cirurgia de NOME em ...", "atendimento da NOME" — clinics phrase it this way
// often enough that skipping it loses real invoices (NF 936, R$ 4.048,10).
//
// NOT case-insensitive, deliberately: the capitalisation is what separates a
// person from a procedure. With /i this matched "sessões de psicoterapia
// realizadas" and produced a patient called "psicoterapia realizadas" on three
// real invoices. "sessões" is likewise absent from the verbs — no invoice names
// the patient that way, and including it only invited that false match.
const RE_PATIENT_OF =
  /(?:cirurgia|atendimento|consulta|procedimento|exame|Cirurgia|Atendimento|Consulta|Procedimento|Exame)\s+(?:de|da|do)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){1,3})/;

const RE_COUNCIL =
  /\b(CRM|CRP|CRO|CRN|CRF|CREFITO|COREN)\s*[:\-]?\s*([0-9][0-9./-]*[0-9])(?:\s*[-/]\s*([A-Z]{2})\b)?/i;

const RE_DOCTOR =
  /\bDr[ao]?\.?\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){0,3})/;

// Tokens that mean the name ended and a new field began.
const RE_STOP = /^(medic|clinic|especialidade|servi|valor|refer|cid|crm|crp|data|em)$/i;

function tidyName(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim().replace(/^[.:\-|]+|[.:\-|]+$/g, "");
  const kept: string[] = [];
  for (const token of flat.split(" ")) {
    if (RE_STOP.test(token)) break;
    kept.push(token);
    if (kept.length === 4) break;
  }
  return kept.join(" ").trim();
}

/**
 * Snap a name to the policy roster. Invoices misspell names and OCR mangles
 * them ("Mila Hakim Malka" for "Mila Esther Malka"), and the insurer needs the
 * name it has on file. Matches on first name, which is unique per roster.
 */
export function canonicaliseName(raw: string, roster: string[]): { name: string; matched: boolean } {
  const clean = tidyName(raw);
  if (!clean) return { name: "", matched: false };

  const byFirst = new Map<string, string>();
  for (const full of roster) {
    const first = full.trim().split(/\s+/)[0]?.toLowerCase();
    if (first && !byFirst.has(first)) byFirst.set(first, full);
  }
  for (const token of clean.toLowerCase().match(/[a-zà-ÿ']+/g) ?? []) {
    const hit = byFirst.get(token);
    if (hit) return { name: hit, matched: true };
  }
  return { name: clean, matched: false };
}

/**
 * Who was treated, and how confident we are.
 *
 * Order matters: the stored field, then the invoice body, then — only as a last
 * resort — the recipient. The recipient is who the invoice was issued TO, which
 * is the payer. For an adult's own consultation that is the patient; for a
 * child's it is the parent. 30 of 33 invoices here name the same adult as
 * recipient, so treating recipient as patient would mislabel every child's
 * claim. It is therefore always returned unconfirmed.
 */
export function resolvePatient(nf: NfLike, roster: string[]): ResolvedPatient {
  const desc = nf.service_description ?? "";

  const fromField = nf.patient_name?.trim();
  if (fromField) {
    const { name, matched } = canonicaliseName(fromField, roster);
    // Someone typed this in, so trust it even off-roster (a new dependent may
    // not be registered yet) — but then it is not confirmed against the policy.
    if (name) return { name, source: "field", confirmed: matched };
  }

  for (const re of [RE_PATIENT_LABEL, RE_PATIENT_OF]) {
    const m = desc.match(re);
    if (!m?.[1]) continue;
    const { name, matched } = canonicaliseName(m[1], roster);
    // A name scraped from free text is only believable if it is someone on the
    // policy. Anything else is an extraction error wearing a name's clothes —
    // "psicoterapia realizadas" reached production as a confirmed patient this
    // way. Skip it and let a weaker source answer instead of inventing someone.
    if (matched && name.length >= 3) {
      return { name, source: "description", confirmed: true };
    }
  }

  const recipient = nf.recipient_name?.trim();
  if (recipient) {
    const { name } = canonicaliseName(recipient, roster);
    if (name) return { name, source: "recipient", confirmed: false };
  }

  return { name: "", source: "unknown", confirmed: false };
}

/** The doctor's council registration, dug out of the invoice text. */
export function extractCouncilId(description: string | null): CouncilId | null {
  const m = (description ?? "").match(RE_COUNCIL);
  if (!m) return null;
  return {
    council: m[1].toUpperCase(),
    number: m[2].replace(/[.\-/]$/, ""),
    uf: m[3] ? m[3].toUpperCase() : null
  };
}

/**
 * The treating doctor's name. `provider_name` is usually the billing company
 * ("D V KATZ SERVIÇOS MEDICOS EIRELI ME"), not the person the insurer asks for.
 */
export function extractDoctorName(description: string | null): string | null {
  const m = (description ?? "").match(RE_DOCTOR);
  if (!m?.[1]) return null;
  const name = tidyName(m[1]);
  return name.length >= 3 ? name : null;
}

export type ClaimGap = "patient_unknown" | "patient_unconfirmed" | "no_pdf" | "no_cnpj";

/** What still blocks this invoice from being sent to the insurer. */
export function claimGaps(nf: NfLike, patient: ResolvedPatient): ClaimGap[] {
  const gaps: ClaimGap[] = [];
  if (!patient.name) gaps.push("patient_unknown");
  else if (!patient.confirmed) gaps.push("patient_unconfirmed");
  if (!nf.storage_path) gaps.push("no_pdf");
  if (!nf.provider_cnpj) gaps.push("no_cnpj");
  return gaps;
}

export const GAP_LABEL: Record<ClaimGap, string> = {
  patient_unknown: "Paciente não identificado — pedir ao prestador",
  patient_unconfirmed: "Paciente provável — confirmar antes de enviar",
  no_pdf: "Sem PDF da nota — pedir 2ª via ao prestador",
  no_cnpj: "Sem CNPJ do prestador — consta no PDF"
};

/** Two or three words, for the reason column in the list. */
export const GAP_SHORT: Record<ClaimGap, string> = {
  patient_unknown: "Falta o paciente",
  patient_unconfirmed: "Confirmar paciente",
  no_pdf: "Falta o PDF",
  no_cnpj: "Falta o CNPJ"
};

export const PATIENT_SOURCE_LABEL: Record<PatientSource, string> = {
  field: "cadastrado no sistema",
  description: "lido da descrição da nota",
  recipient: "PROVÁVEL — destinatário da nota",
  unknown: "não identificado"
};

/** Documents the APRIL policy requires with every claim (policy_terms). */
export const REQUIRED_DOCUMENTS = [
  "Nota/recibo do valor pago, e a prescrição médica datada",
  "Formulário de pré-aprovação, quando o tratamento exigir",
  "Em internação: relatório hospitalar e Atestado Médico Confidencial"
] as const;

/**
 * Outer limit for filing. The policy's General Conditions bar legal action
 * "two years from the event which gave rise to them"; no separate
 * administrative window is stated anywhere in the documents, so two years from
 * the service date is the operative limit. Shown per claim because the
 * Bradesco-era invoices are the OLDEST and therefore the first to die, which
 * is the opposite of the order their value suggests.
 */
export function claimDeadline(emissionDate: string | null): string | null {
  if (!emissionDate) return null;
  const day = emissionDate.slice(0, 10);
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // JS rolls an impossible date forward: "2026-02-29" silently becomes 1 March
  // and would print a confident deadline computed from a date that does not
  // exist. Round-trip it and refuse rather than answer with a plausible lie.
  if (d.toISOString().slice(0, 10) !== day) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  return d.toISOString().slice(0, 10);
}

/** Whole days until the filing limit. Negative once it has passed. */
export function daysUntil(deadline: string | null, today: string): number | null {
  if (!deadline) return null;
  const a = Date.parse(`${deadline}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
