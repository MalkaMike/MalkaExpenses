/**
 * Lifecycle of one reimbursement claim, stored on `nota_fiscais`.
 *
 * The columns already existed (`reimbursement_status/_amount/_submitted_at/
 * _notes`) but carried no state machine — every row simply sat on
 * "not_submitted", written by the two import scripts. This defines the states
 * and the legal moves between them.
 *
 * Deliberately NOT using `reimbursement_claims`: that table has a richer
 * lifecycle but only 2 rows exist against 33 medical invoices, so keying the
 * secretary's queue on it would show her an empty page. It stays for the
 * eligibility/AI flow.
 *
 * This is a money trail — a claim moving backwards, or "reimbursed" without an
 * amount, is a real accounting error, so transitions are validated rather than
 * trusted.
 */

export const CLAIM_STATES = [
  "not_submitted",
  "with_secretary",
  "submitted",
  "reimbursed",
  "rejected"
] as const;

export type ClaimState = (typeof CLAIM_STATES)[number];

export function isClaimState(v: unknown): v is ClaimState {
  return typeof v === "string" && (CLAIM_STATES as readonly string[]).includes(v);
}

/** Legal moves. Anything not listed here is refused. */
const TRANSITIONS: Record<ClaimState, ClaimState[]> = {
  not_submitted: ["with_secretary"],
  // Straight to reimbursed is allowed: some claims are paid at the counter and
  // the secretary only learns after the fact.
  with_secretary: ["submitted", "not_submitted"],
  submitted: ["reimbursed", "rejected", "with_secretary"],
  // Terminal states can be reopened — an insurer reversal or a re-appeal is
  // ordinary, and forcing a dead end would push people to edit the DB by hand.
  reimbursed: ["submitted"],
  rejected: ["submitted", "with_secretary"]
};

export function canTransition(from: ClaimState, to: ClaimState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export type TransitionInput = {
  amount?: number | null;
  submittedAt?: string | null;
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a move before it touches the database.
 *
 * "reimbursed" demands a positive amount: a reimbursement with no value is how
 * money quietly goes missing from the ledger, and the whole point of this
 * screen is to know how much came back.
 */
export function checkTransition(
  from: ClaimState,
  to: ClaimState,
  input: TransitionInput = {}
): TransitionCheck {
  if (from === to) {
    return { ok: false, error: `A nota já está em "${STATE_LABEL[to]}".` };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `Não dá para ir de "${STATE_LABEL[from]}" para "${STATE_LABEL[to]}".`
    };
  }
  if (to === "reimbursed") {
    const amount = input.amount;
    if (amount == null || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Informe o valor reembolsado (maior que zero)." };
    }
  }
  if (to === "submitted") {
    const d = input.submittedAt;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ok: false, error: "Data de envio inválida (use AAAA-MM-DD)." };
    }
  }
  return { ok: true };
}

export const STATE_LABEL: Record<ClaimState, string> = {
  not_submitted: "A enviar",
  with_secretary: "Comigo",
  submitted: "Enviado ao seguro",
  reimbursed: "Reembolsado",
  rejected: "Recusado"
};

/** What the secretary's button says for the next step, per state. */
export const NEXT_ACTION: Partial<Record<ClaimState, { to: ClaimState; label: string }>> = {
  not_submitted: { to: "with_secretary", label: "Assumir este pedido" },
  with_secretary: { to: "submitted", label: "Enviei ao seguro" },
  submitted: { to: "reimbursed", label: "Registrar reembolso" }
};

/** Display order of the queue columns — work to be done first. */
export const STATE_ORDER: ClaimState[] = [
  "not_submitted",
  "with_secretary",
  "submitted",
  "rejected",
  "reimbursed"
];
