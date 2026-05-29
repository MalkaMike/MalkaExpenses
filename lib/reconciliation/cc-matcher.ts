// Credit-card reconciliation matcher.
//
// When a bank account pays a credit-card bill, the bank statement shows ONE
// outflow ("PAG FATURA CARTAO", negative amount). The credit-card statement
// shows the closing balance (positive amount owed). If we import both, that
// payment double-counts: once as the bank outflow, once as the sum of CC line
// items. Reconciliation links the bank outflow to the CC statement and marks
// the bank line as a transfer so it's excluded from category/spend totals.
//
// This module is a PURE function (no I/O) so it can be unit-tested. The API
// route does the DB reads/writes around it.

export type BankTxInput = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // negative for a payment OUT
  description: string;
};

export type CcStatementInput = {
  id: string; // statement_imports.id
  accountId: string; // the credit-card account id
  accountName: string; // for display in the review picker
  closingBalance: number | null; // positive amount owed on the statement
  dueDate: string | null; // YYYY-MM-DD — fatura due date (PDF only)
  closeDate: string | null; // YYYY-MM-DD — statement close (≈ last line-item date); fallback for OFX / early payers
  ccIssuer: string | null; // accounts.cc_issuer (e.g. "nubank", "itau")
};

export type CcMatchCandidate = {
  statementId: string;
  accountId: string;
  accountName: string;
  confidence: number; // 0..1
  amountDelta: number; // |closingBalance + bankTx.amount|
  dayDelta: number; // |dueDate - bankTx.date| in days
  issuerMatched: boolean;
};

// Heuristic: does this bank-transaction description look like a CC bill payment?
const PAYMENT_RE = /pag.*cart|fatura|cart[aã]o|credit\s*card|\bcc\b/i;

export function isCcPaymentDescription(desc: string): boolean {
  return PAYMENT_RE.test(desc);
}

// Whole-day distance between two YYYY-MM-DD dates (UTC, sign-agnostic).
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(da - db) / 86_400_000);
}

export type MatchOpts = {
  amountTolerance?: number; // ±R$ on the bill amount
  dueWindow?: number; // ±days around the fatura due date (tight — payment lands near due date)
  closeWindow?: number; // days after statement close a payment may land (wider — close is ~7-12d before due)
};

/**
 * Find candidate CC statements that the given bank payment could be settling.
 * Returns candidates sorted best-first (highest confidence, then tightest
 * amount, then tightest date). Empty array if none qualify.
 *
 * A statement qualifies on amount (±tolerance) AND a date match against EITHER:
 *   - its due date, within `dueWindow` days (strong signal), OR
 *   - its close date, within `closeWindow` days (fallback for OFX statements
 *     that carry no due date, and for early auto-debit payers).
 *
 * The caller decides what to do with the result:
 *   - exactly 1 candidate with confidence >= 0.80 → auto-link
 *   - otherwise → surface for manual review (no silent guessing)
 */
export function matchCcPayment(
  bankTx: BankTxInput,
  statements: CcStatementInput[],
  opts: MatchOpts = {}
): CcMatchCandidate[] {
  const amountTol = opts.amountTolerance ?? 1.0; // ±R$1
  const dueWindow = opts.dueWindow ?? 5; // ±5 days around due date
  const closeWindow = opts.closeWindow ?? 12; // up to ~12 days after close

  // Only outflows can be a bill payment.
  if (bankTx.amount >= 0) return [];

  const descLower = bankTx.description.toLowerCase();
  const candidates: CcMatchCandidate[] = [];

  for (const st of statements) {
    if (st.closingBalance == null) continue;

    // payment ≈ -closingBalance  ⇒  closingBalance + amount ≈ 0
    const amountDelta = Math.abs(st.closingBalance + bankTx.amount);
    if (amountDelta > amountTol) continue;

    // Date check against due date (tight) and/or close date (wider). Take the
    // closest qualifying one; remember whether the strong due-date signal hit.
    let bestDelta = Number.POSITIVE_INFINITY;
    let matchedViaDue = false;

    if (st.dueDate) {
      const d = daysBetween(bankTx.date, st.dueDate);
      if (d <= dueWindow && d < bestDelta) {
        bestDelta = d;
        matchedViaDue = true;
      }
    }
    if (st.closeDate) {
      const d = daysBetween(bankTx.date, st.closeDate);
      if (d <= closeWindow && d < bestDelta) {
        bestDelta = d;
        matchedViaDue = false;
      }
    }
    if (!Number.isFinite(bestDelta)) continue; // no date matched

    const issuerMatched =
      !!st.ccIssuer && descLower.includes(st.ccIssuer.toLowerCase());

    // Confidence: base + amount tightness + date signal + issuer signal.
    let confidence = 0.6;
    if (amountDelta < 0.01) confidence += 0.2; // exact-to-the-cent is very strong
    else if (amountDelta < 1.0) confidence += 0.1;
    if (matchedViaDue && bestDelta <= 2) confidence += 0.1; // tight due-date hit
    else if (matchedViaDue) confidence += 0.05;
    if (issuerMatched) confidence += 0.1;
    confidence = Math.min(0.99, confidence);

    candidates.push({
      statementId: st.id,
      accountId: st.accountId,
      accountName: st.accountName,
      confidence,
      amountDelta,
      dayDelta: bestDelta,
      issuerMatched
    });
  }

  candidates.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.amountDelta - b.amountDelta ||
      a.dayDelta - b.dayDelta
  );

  return candidates;
}

// Should the caller auto-link without asking the user?
export function shouldAutoLink(candidates: CcMatchCandidate[]): boolean {
  return candidates.length === 1 && candidates[0].confidence >= 0.8;
}
