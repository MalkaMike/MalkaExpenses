/**
 * Celina has two jobs, and they are not the same kind of work.
 *
 *  1. APRIL  — chase each doctor for the report/laudo, one phone call per
 *              provider. Slow, per-provider, needs the document stored.
 *  2. Bradesco (the pre-25/02/2026 insurer) — they ask for nothing beyond the
 *              invoice itself. So it is not chasing at all: it is one batch
 *              send of every old nota.
 *
 * Treating job 2 like job 1 sent her to phone doctors for reports nobody asked
 * for. This module is the whole of job 2, kept pure so the money and the counts
 * can be tested without a browser or a database.
 */

import type { ClaimState } from "./claim-status";

/** The little this job needs from an invoice. */
export type BatchClaim = {
  id: string;
  nfNumber: string | null;
  emissionDate: string | null;
  providerName: string | null;
  patient: string | null;
  amount: number | null;
  hasPdf: boolean;
  state: ClaimState;
  insurer: "april" | "anterior";
};

/**
 * Already gone to the insurer, so not part of the next send. "rejected" is
 * deliberately NOT here: a refused claim is work again, not a finished one.
 */
const ALREADY_SENT: ClaimState[] = ["submitted", "reimbursed"];

export type BradescoBatch<T extends BatchClaim = BatchClaim> = {
  /** Everything pre-25/02, newest first — the whole job in one place. */
  all: T[];
  /** Still to send. This is what the button acts on. */
  pending: T[];
  /** Already with Bradesco (or already paid). Shown, never re-sent. */
  sent: T[];
  pendingTotal: number;
  sentTotal: number;
  total: number;
  /**
   * Pending invoices with no PDF stored. They cannot be sent — naming them is
   * the difference between "10 to send" and her discovering the gap one by one.
   */
  missingPdf: T[];
  /** Nothing left to do: there were invoices and every one has gone. */
  done: boolean;
};

const sum = <T extends BatchClaim>(l: T[]): number =>
  l.reduce((s, c) => s + (c.amount ?? 0), 0);

export function bradescoBatch<T extends BatchClaim>(
  claims: T[],
): BradescoBatch<T> {
  const all = claims
    .filter((c) => c.insurer === "anterior")
    // Newest first, matching every other list on these screens.
    .sort((a, b) => (b.emissionDate ?? "").localeCompare(a.emissionDate ?? ""));

  const sent = all.filter((c) => ALREADY_SENT.includes(c.state));
  const pending = all.filter((c) => !ALREADY_SENT.includes(c.state));

  return {
    all,
    pending,
    sent,
    pendingTotal: sum(pending),
    sentTotal: sum(sent),
    total: sum(all),
    missingPdf: pending.filter((c) => !c.hasPdf),
    done: all.length > 0 && pending.length === 0,
  };
}
