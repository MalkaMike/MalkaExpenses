import { describe, it, expect } from "vitest";
import { pairReissued, supersededForecasts } from "../reissued";

describe("supersededForecasts", () => {
  it("flags the PENDING forecast once the POSTED instalment exists", () => {
    const s = supersededForecasts([
      { id: "posted", status: "POSTED", description: "NICOM             08/08", amount: 602.51 },
      { id: "forecast", status: "PENDING", description: "NICOM             08/08", amount: 602.51 },
      { id: "future", status: "PENDING", description: "AMAZON PRIME BR   09/12", amount: 13.9 }
    ]);
    expect([...s]).toEqual(["forecast"]);
  });
});

// Shapes and values from the real ledger (2026-10-15).
const orphan = (id: string, date: string, d: string, c: number) => ({ id, date, description_raw: d, real_amount: c });
const incoming = (ext: string, date: string, d: string, c: number) => ({ external_id: ext, date, description_raw: d, real_amount: c });

describe("pairReissued", () => {
  it("pairs a re-dated instalment even weeks apart", () => {
    const p = pairReissued(
      [incoming("new", "2026-09-14", "NICOM             08/08", -60251)],
      [orphan("old", "2026-10-20", "NICOM             08/08", -60251)]
    );
    expect(p.map((x) => x.orphan.id)).toEqual(["old"]);
  });

  it("pairs a same-amount row within 5 days, any wording", () => {
    const p = pairReissued(
      [incoming("new", "2026-10-14", "Resgate RES APLIC AUT MAIS", 107074)],
      [orphan("old", "2026-10-10", "Entrada RES APLIC AUT MAIS AP", 107074)]
    );
    expect(p).toHaveLength(1);
  });

  it("never pairs a different instalment, amount, or a far date", () => {
    const p = pairReissued(
      [
        incoming("a", "2026-09-14", "NICOM             07/08", -60251), // other instalment, 36 days
        incoming("b", "2026-10-09", "IMPOSTO MUNICIPAL - PMSP", -88840), // monthly bill, 30 days later
        incoming("c", "2026-10-20", "NICOM             08/08", -60252) // amount differs
      ],
      [
        orphan("x", "2026-10-20", "NICOM             08/08", -60251),
        orphan("y", "2026-09-09", "IMPOSTO MUNICIPAL - PMSP", -88840)
      ]
    );
    expect(p).toEqual([]);
  });

  it("is 1:1 and picks the closest date", () => {
    const p = pairReissued(
      [incoming("n1", "2026-08-20", "PARAFUZO* PASSADORIA#F", -24100), incoming("n2", "2026-08-21", "PARAFUZO* PASSADORIA#F", -24100)],
      [orphan("o1", "2026-08-20", "PARAFUZO* PASSADORIA#F", -24100)]
    );
    expect(p.map((x) => [x.row.external_id, x.orphan.id])).toEqual([["n1", "o1"]]);
  });
});
