import { describe, it, expect } from "vitest";
import { bradescoBatch, type BatchClaim } from "../bradesco-batch";

function claim(over: Partial<BatchClaim> = {}): BatchClaim {
  return {
    id: over.id ?? "1",
    nfNumber: "100",
    emissionDate: "2026-01-10",
    providerName: "DR X",
    patient: "Lavi Malka",
    amount: 100,
    hasPdf: true,
    state: "not_submitted",
    insurer: "anterior",
    ...over,
  };
}

describe("bradescoBatch", () => {
  it("takes only the pre-APRIL invoices", () => {
    const b = bradescoBatch([
      claim({ id: "a", insurer: "anterior" }),
      claim({ id: "b", insurer: "april" }),
    ]);
    expect(b.all.map((c) => c.id)).toEqual(["a"]);
  });

  it("splits what is still to send from what already went", () => {
    const b = bradescoBatch([
      claim({ id: "todo", state: "not_submitted", amount: 300 }),
      claim({ id: "mine", state: "with_secretary", amount: 200 }),
      claim({ id: "gone", state: "submitted", amount: 50 }),
      claim({ id: "paid", state: "reimbursed", amount: 25 }),
    ]);
    expect(b.pending.map((c) => c.id).sort()).toEqual(["mine", "todo"]);
    expect(b.sent.map((c) => c.id).sort()).toEqual(["gone", "paid"]);
    expect(b.pendingTotal).toBe(500);
    expect(b.sentTotal).toBe(75);
    expect(b.total).toBe(575);
  });

  it("treats a refused claim as work again, not as sent", () => {
    const b = bradescoBatch([claim({ id: "no", state: "rejected" })]);
    expect(b.pending.map((c) => c.id)).toEqual(["no"]);
    expect(b.sent).toEqual([]);
    expect(b.done).toBe(false);
  });

  it("names the pending invoices that have no PDF to send", () => {
    const b = bradescoBatch([
      claim({ id: "ok", hasPdf: true }),
      claim({ id: "nopdf", hasPdf: false }),
      // Already sent and missing a PDF is not a problem to raise.
      claim({ id: "sent-nopdf", hasPdf: false, state: "submitted" }),
    ]);
    expect(b.missingPdf.map((c) => c.id)).toEqual(["nopdf"]);
  });

  it("is done only when there was something and all of it has gone", () => {
    expect(bradescoBatch([]).done).toBe(false);
    expect(bradescoBatch([claim({ state: "submitted" })]).done).toBe(true);
    expect(bradescoBatch([claim({ state: "not_submitted" })]).done).toBe(false);
  });

  it("orders newest first", () => {
    const b = bradescoBatch([
      claim({ id: "old", emissionDate: "2025-03-01" }),
      claim({ id: "new", emissionDate: "2026-02-01" }),
      claim({ id: "mid", emissionDate: "2025-12-01" }),
    ]);
    expect(b.all.map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("survives null amounts and null dates without NaN", () => {
    const b = bradescoBatch([
      claim({ id: "n", amount: null, emissionDate: null }),
      claim({ id: "m", amount: 40 }),
    ]);
    expect(b.total).toBe(40);
    expect(b.pendingTotal).toBe(40);
    expect(b.all).toHaveLength(2);
  });
});
