import { describe, it, expect } from "vitest";
import {
  isClaimState,
  canTransition,
  checkTransition,
  CLAIM_STATES,
  STATE_LABEL,
  NEXT_ACTION
} from "../claim-status";

describe("isClaimState", () => {
  it("accepts the known states and rejects anything else", () => {
    for (const s of CLAIM_STATES) expect(isClaimState(s)).toBe(true);
    for (const bad of ["", "pago", "SUBMITTED", null, undefined, 3, {}]) {
      expect(isClaimState(bad)).toBe(false);
    }
  });
});

describe("canTransition", () => {
  it("walks the happy path", () => {
    expect(canTransition("not_submitted", "with_secretary")).toBe(true);
    expect(canTransition("with_secretary", "submitted")).toBe(true);
    expect(canTransition("submitted", "reimbursed")).toBe(true);
  });

  it("refuses to skip the queue", () => {
    expect(canTransition("not_submitted", "submitted")).toBe(false);
    expect(canTransition("not_submitted", "reimbursed")).toBe(false);
    expect(canTransition("with_secretary", "reimbursed")).toBe(false);
  });

  it("allows reopening a settled claim — insurers reverse and appeals happen", () => {
    expect(canTransition("reimbursed", "submitted")).toBe(true);
    expect(canTransition("rejected", "submitted")).toBe(true);
  });
});

describe("checkTransition", () => {
  it("refuses a no-op", () => {
    const r = checkTransition("submitted", "submitted");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(STATE_LABEL.submitted);
  });

  it("names both states when the move is illegal", () => {
    const r = checkTransition("not_submitted", "reimbursed", { amount: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(STATE_LABEL.not_submitted);
      expect(r.error).toContain(STATE_LABEL.reimbursed);
    }
  });

  it("will not record a reimbursement without a positive amount", () => {
    for (const amount of [undefined, null, 0, -5, Number.NaN]) {
      const r = checkTransition("submitted", "reimbursed", { amount: amount as number });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/valor reembolsado/i);
    }
  });

  it("accepts a reimbursement with a real amount", () => {
    expect(checkTransition("submitted", "reimbursed", { amount: 1070 })).toEqual({ ok: true });
  });

  it("rejects a malformed submission date but accepts an ISO one or none", () => {
    expect(checkTransition("with_secretary", "submitted", { submittedAt: "12/08/2026" }).ok).toBe(false);
    expect(checkTransition("with_secretary", "submitted", { submittedAt: "2026-08-12" })).toEqual({ ok: true });
    expect(checkTransition("with_secretary", "submitted")).toEqual({ ok: true });
  });
});

describe("NEXT_ACTION", () => {
  it("offers a next step for every state that has work left", () => {
    expect(NEXT_ACTION.not_submitted?.to).toBe("with_secretary");
    expect(NEXT_ACTION.with_secretary?.to).toBe("submitted");
    expect(NEXT_ACTION.submitted?.to).toBe("reimbursed");
  });

  it("offers no next step once the money is in", () => {
    expect(NEXT_ACTION.reimbursed).toBeUndefined();
  });

  it("only ever proposes a legal move", () => {
    for (const [from, action] of Object.entries(NEXT_ACTION)) {
      if (action) expect(canTransition(from as never, action.to)).toBe(true);
    }
  });
});
