import { describe, it, expect } from "vitest";
import {
  realBalance,
  sharedBalance,
  monthlyCategoryTotals,
  monthlyNet,
  type Tx
} from "./monthly";

// ============================================================================
// The dual-ledger math — the most important invariants in the app.
// ============================================================================
//
// Test transactions:
//   t1 — normal expense, fully visible (real = shared = -100)
//   t2 — partially hidden expense (real = -1000, shared = -300)
//   t3 — fully hidden expense (real = -500, shared = 0)
//   t4 — fake income (real = 0, shared = +400, is_fake=true)
//   t5 — CC payment, transfer (real = shared = -2000, is_transfer=true)
// ============================================================================

const fixtures: Tx[] = [
  { date: "2025-03-15", realAmount: -100, sharedAmount: -100, isFake: false, isTransfer: false, categorySlug: "mercado" },
  { date: "2025-03-20", realAmount: -1000, sharedAmount: -300, isFake: false, isTransfer: false, categorySlug: "viagens" },
  { date: "2025-03-25", realAmount: -500, sharedAmount: 0, isFake: false, isTransfer: false, categorySlug: "lazer" },
  { date: "2025-03-28", realAmount: 0, sharedAmount: 400, isFake: true, isTransfer: false, categorySlug: "receita" },
  { date: "2025-03-30", realAmount: -2000, sharedAmount: -2000, isFake: false, isTransfer: true, categorySlug: "cartao_pagamento" }
];

describe("realBalance", () => {
  it("sums all real amounts including hidden and transfers, excluding fakes by construction", () => {
    // -100 + -1000 + -500 + 0 + -2000 = -3600
    expect(realBalance(10000, fixtures)).toBe(10000 - 3600);
  });
});

describe("sharedBalance", () => {
  it("sums all shared amounts; hidden contribute 0; fakes do contribute; transfers do too", () => {
    // -100 + -300 + 0 + 400 + -2000 = -2000
    expect(sharedBalance(10000, fixtures)).toBe(10000 - 2000);
  });
});

describe("monthlyCategoryTotals — shared view", () => {
  it("excludes transfers and hidden rows; includes fake entries", () => {
    const result = monthlyCategoryTotals(fixtures, "shared");
    const byCat = Object.fromEntries(result.map((r) => [r.categorySlug, r.total]));
    expect(byCat.mercado).toBe(-100);
    expect(byCat.viagens).toBe(-300); // partial
    expect(byCat.lazer).toBeUndefined(); // hidden
    expect(byCat.receita).toBe(400); // fake
    expect(byCat.cartao_pagamento).toBeUndefined(); // transfer
  });
});

describe("monthlyCategoryTotals — real view", () => {
  it("excludes transfers; includes hidden and partial rows at real amount", () => {
    const result = monthlyCategoryTotals(fixtures, "real");
    const byCat = Object.fromEntries(result.map((r) => [r.categorySlug, r.total]));
    expect(byCat.mercado).toBe(-100);
    expect(byCat.viagens).toBe(-1000); // real, not shared
    expect(byCat.lazer).toBe(-500); // visible in real view
    expect(byCat.receita).toBeUndefined(); // fake entry has real_amount=0, filtered out
    expect(byCat.cartao_pagamento).toBeUndefined(); // transfer
  });
});

describe("monthlyNet", () => {
  it("differs between real and shared views", () => {
    const realNet = monthlyNet(fixtures, "real");
    const sharedNet = monthlyNet(fixtures, "shared");
    expect(realNet[0].month).toBe("2025-03");
    expect(sharedNet[0].month).toBe("2025-03");
    // real: -100 -1000 -500 + 0 = -1600 (transfers excluded)
    expect(realNet[0].net).toBe(-1600);
    // shared: -100 -300 + 0 + 400 = 0 (transfers excluded, hidden=0)
    expect(sharedNet[0].net).toBe(0);
  });
});

describe("boundary cases", () => {
  it("empty inputs return starting balance / empty arrays", () => {
    expect(realBalance(500, [])).toBe(500);
    expect(sharedBalance(500, [])).toBe(500);
    expect(monthlyCategoryTotals([], "shared")).toEqual([]);
    expect(monthlyNet([], "real")).toEqual([]);
  });

  it("multiple months sort newest first", () => {
    const multi: Tx[] = [
      { date: "2025-01-10", realAmount: -50, sharedAmount: -50, isFake: false, isTransfer: false, categorySlug: "mercado" },
      { date: "2025-05-10", realAmount: -70, sharedAmount: -70, isFake: false, isTransfer: false, categorySlug: "mercado" }
    ];
    const net = monthlyNet(multi, "shared");
    expect(net[0].month).toBe("2025-05");
    expect(net[1].month).toBe("2025-01");
  });
});
