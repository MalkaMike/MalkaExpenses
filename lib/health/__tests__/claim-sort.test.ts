import { describe, it, expect } from "vitest";
import { sortClaims, defaultDir, type SortableClaim } from "../claim-sort";
import type { ClaimState } from "../claim-status";
import type { ClaimOwner } from "../claim-guidance";

function claim(p: Partial<SortableClaim> & { providerName: string }): SortableClaim {
  return {
    emissionDate: "2026-03-01",
    patient: "Ilay Malka",
    amount: 100,
    state: "not_submitted" as ClaimState,
    guidance: { owner: "secretary" as ClaimOwner },
    ...p
  };
}

const names = (rows: SortableClaim[]) => rows.map((r) => r.providerName);

describe("sortClaims", () => {
  it("sorts amount descending with -1", () => {
    const rows = [
      claim({ providerName: "b", amount: 50 }),
      claim({ providerName: "a", amount: 900 }),
      claim({ providerName: "c", amount: 300 })
    ];
    expect(names(sortClaims(rows, "amount", -1))).toEqual(["a", "c", "b"]);
    expect(names(sortClaims(rows, "amount", 1))).toEqual(["b", "c", "a"]);
  });

  it("keeps blanks last in BOTH directions", () => {
    const rows = [
      claim({ providerName: "sem valor", amount: null }),
      claim({ providerName: "com valor", amount: 10 })
    ];
    expect(names(sortClaims(rows, "amount", -1))).toEqual(["com valor", "sem valor"]);
    expect(names(sortClaims(rows, "amount", 1))).toEqual(["com valor", "sem valor"]);
  });

  it("orders states by the work-first order, not alphabetically", () => {
    const rows = [
      claim({ providerName: "pago", state: "reimbursed" }),
      claim({ providerName: "a enviar", state: "not_submitted" }),
      claim({ providerName: "enviado", state: "submitted" })
    ];
    expect(names(sortClaims(rows, "state", 1))).toEqual(["a enviar", "enviado", "pago"]);
  });

  it("puts the secretary's own work above Mickael's and above blocked", () => {
    const rows = [
      claim({ providerName: "travado", guidance: { owner: "blocked" } }),
      claim({ providerName: "mickael", guidance: { owner: "mickael" } }),
      claim({ providerName: "celina", guidance: { owner: "secretary" } })
    ];
    expect(names(sortClaims(rows, "owner", 1))).toEqual(["celina", "mickael", "travado"]);
  });

  it("breaks ties on the biggest amount", () => {
    const rows = [
      claim({ providerName: "pequeno", state: "not_submitted", amount: 10 }),
      claim({ providerName: "grande", state: "not_submitted", amount: 5000 })
    ];
    expect(names(sortClaims(rows, "state", 1))).toEqual(["grande", "pequeno"]);
  });

  it("sorts text with Portuguese accents in the right place", () => {
    const rows = [
      claim({ providerName: "Zé" }),
      claim({ providerName: "Ápice" }),
      claim({ providerName: "Bauer" })
    ];
    expect(names(sortClaims(rows, "provider", 1))).toEqual(["Ápice", "Bauer", "Zé"]);
  });

  it("sorts dates chronologically as ISO strings", () => {
    const rows = [
      claim({ providerName: "meio", emissionDate: "2026-02-10" }),
      claim({ providerName: "novo", emissionDate: "2026-11-01" }),
      claim({ providerName: "velho", emissionDate: "2025-12-31" })
    ];
    expect(names(sortClaims(rows, "date", -1))).toEqual(["novo", "meio", "velho"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [claim({ providerName: "b", amount: 1 }), claim({ providerName: "a", amount: 2 })];
    sortClaims(rows, "amount", -1);
    expect(names(rows)).toEqual(["b", "a"]);
  });

  it("defaults money and dates to descending, text to ascending", () => {
    expect(defaultDir("amount")).toBe(-1);
    expect(defaultDir("date")).toBe(-1);
    expect(defaultDir("provider")).toBe(1);
    expect(defaultDir("state")).toBe(1);
  });
});
