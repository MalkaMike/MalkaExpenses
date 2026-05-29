import { describe, it, expect } from "vitest";
import {
  matchCcPayment,
  shouldAutoLink,
  isCcPaymentDescription,
  daysBetween,
  type CcStatementInput
} from "../cc-matcher";

// A pair of CC statements to match against.
const nubankStatement: CcStatementInput = {
  id: "st-nubank",
  accountId: "acc-nubank",
  accountName: "Nubank CC",
  closingBalance: 4685.3, // owed
  dueDate: "2026-05-10",
  closeDate: "2026-05-01", // statement closed ~9 days before due
  ccIssuer: "nubank"
};

const itauStatement: CcStatementInput = {
  id: "st-itau",
  accountId: "acc-itau",
  accountName: "Itaú Personnalité CC",
  closingBalance: 12000.0,
  dueDate: "2026-05-15",
  closeDate: "2026-05-06",
  ccIssuer: "itau"
};

describe("isCcPaymentDescription", () => {
  it("recognizes common BR CC payment descriptions", () => {
    expect(isCcPaymentDescription("PAGTO FATURA CARTAO")).toBe(true);
    expect(isCcPaymentDescription("PAG CARTAO NUBANK")).toBe(true);
    expect(isCcPaymentDescription("Pagamento de fatura")).toBe(true);
    expect(isCcPaymentDescription("CARTÃO DE CRÉDITO")).toBe(true);
  });
  it("ignores ordinary purchases", () => {
    expect(isCcPaymentDescription("IFD*KAISEKI")).toBe(false);
    expect(isCcPaymentDescription("AUTO POSTO RAMAL")).toBe(false);
  });
});

describe("daysBetween", () => {
  it("computes whole-day distance regardless of order", () => {
    expect(daysBetween("2026-05-10", "2026-05-15")).toBe(5);
    expect(daysBetween("2026-05-15", "2026-05-10")).toBe(5);
    expect(daysBetween("2026-05-10", "2026-05-10")).toBe(0);
  });
});

describe("matchCcPayment", () => {
  // 1) Exact match: amount exact, due date same day, issuer named in description.
  it("returns a high-confidence single candidate on an exact match", () => {
    const bankTx = {
      id: "b1",
      date: "2026-05-10",
      amount: -4685.3,
      description: "PAG FATURA CARTAO NUBANK"
    };
    const out = matchCcPayment(bankTx, [nubankStatement, itauStatement]);
    expect(out).toHaveLength(1);
    expect(out[0].statementId).toBe("st-nubank");
    expect(out[0].issuerMatched).toBe(true);
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(shouldAutoLink(out)).toBe(true);
  });

  // 2) Inflows are never bill payments.
  it("ignores positive (inflow) transactions", () => {
    const bankTx = {
      id: "b2",
      date: "2026-05-10",
      amount: 4685.3, // money IN
      description: "PAG FATURA CARTAO NUBANK"
    };
    expect(matchCcPayment(bankTx, [nubankStatement])).toHaveLength(0);
  });

  // 3) Amount tolerance: within ±R$1 matches, beyond it does not.
  it("respects the ±R$1 amount tolerance", () => {
    const within = matchCcPayment(
      { id: "b3", date: "2026-05-10", amount: -4684.8, description: "fatura" }, // 0.50 off
      [nubankStatement]
    );
    expect(within).toHaveLength(1);

    const beyond = matchCcPayment(
      { id: "b3b", date: "2026-05-10", amount: -4683.3, description: "fatura" }, // 2.00 off
      [nubankStatement]
    );
    expect(beyond).toHaveLength(0);
  });

  // 4a) Due-date window in isolation (no close date): 5 days matches, 7 doesn't.
  it("respects the ±5 day due-date window when no close date is present", () => {
    const dueOnly: CcStatementInput = { ...nubankStatement, closeDate: null };
    const edge = matchCcPayment(
      { id: "b4", date: "2026-05-05", amount: -4685.3, description: "fatura" }, // 5 days before due
      [dueOnly]
    );
    expect(edge).toHaveLength(1);

    const outside = matchCcPayment(
      { id: "b4b", date: "2026-05-03", amount: -4685.3, description: "fatura" }, // 7 days from due
      [dueOnly]
    );
    expect(outside).toHaveLength(0);
  });

  // 4b) Close-date fallback (OFX statement, no due date): a payment landing
  //     after the statement close still matches within the wider close window.
  it("matches via close date when there is no due date (OFX statements)", () => {
    const ofxStyle: CcStatementInput = {
      ...nubankStatement,
      dueDate: null,
      closeDate: "2026-05-01"
    };
    const within = matchCcPayment(
      { id: "b4c", date: "2026-05-09", amount: -4685.3, description: "fatura" }, // 8 days after close
      [ofxStyle]
    );
    expect(within).toHaveLength(1);
    expect(within[0].dayDelta).toBe(8);

    const beyond = matchCcPayment(
      { id: "b4d", date: "2026-05-21", amount: -4685.3, description: "fatura" }, // 20 days after close
      [ofxStyle]
    );
    expect(beyond).toHaveLength(0);
  });

  // 5) Multiple candidates: two statements both plausible → return both, sorted.
  it("returns multiple candidates when two statements qualify", () => {
    const twin: CcStatementInput = {
      ...itauStatement,
      id: "st-itau-twin",
      accountName: "Itaú CC (2)",
      closingBalance: 4685.3, // same balance as nubank
      dueDate: "2026-05-11"
    };
    const out = matchCcPayment(
      { id: "b5", date: "2026-05-10", amount: -4685.3, description: "PAG FATURA CARTAO" },
      [nubankStatement, twin]
    );
    expect(out.length).toBe(2);
    // No auto-link when ambiguous.
    expect(shouldAutoLink(out)).toBe(false);
    // Sorted best-first by confidence.
    expect(out[0].confidence).toBeGreaterThanOrEqual(out[1].confidence);
  });

  // 6) Wrong/absent issuer: still a candidate on amount+date, but lower confidence
  //    than the issuer-named exact match (issuer is a soft signal, not a hard filter).
  it("matches without issuer in description but with lower confidence", () => {
    const out = matchCcPayment(
      { id: "b6", date: "2026-05-10", amount: -4685.3, description: "PAGAMENTO FATURA" },
      [nubankStatement]
    );
    expect(out).toHaveLength(1);
    expect(out[0].issuerMatched).toBe(false);
    expect(out[0].confidence).toBeLessThan(0.95);
  });

  // 7) No candidate when nothing is close.
  it("returns empty when no statement is close", () => {
    const out = matchCcPayment(
      { id: "b7", date: "2026-01-01", amount: -50.0, description: "fatura" },
      [nubankStatement, itauStatement]
    );
    expect(out).toHaveLength(0);
  });
});
