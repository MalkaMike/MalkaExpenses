// Pure functions for balance computation — easy to unit test without a DB.

export type Tx = {
  date: string; // YYYY-MM-DD
  realAmount: number;
  sharedAmount: number;
  isFake: boolean;
  isTransfer: boolean;
  categorySlug: string | null;
};

export function realBalance(startingBalance: number, txs: Tx[]): number {
  return startingBalance + txs.reduce((s, t) => s + t.realAmount, 0);
}

export function sharedBalance(startingBalance: number, txs: Tx[]): number {
  return startingBalance + txs.reduce((s, t) => s + t.sharedAmount, 0);
}

export type MonthlyCategoryTotal = {
  month: string; // YYYY-MM
  categorySlug: string;
  total: number;
};

export function monthlyCategoryTotals(
  txs: Tx[],
  view: "real" | "shared"
): MonthlyCategoryTotal[] {
  const map = new Map<string, MonthlyCategoryTotal>();
  for (const t of txs) {
    if (t.isTransfer) continue;
    const amt = view === "real" ? t.realAmount : t.sharedAmount;
    if (amt === 0) continue;
    if (view === "shared" && t.sharedAmount === 0) continue; // hidden
    const month = t.date.slice(0, 7);
    const cat = t.categorySlug ?? "outros";
    const key = `${month}|${cat}`;
    const existing = map.get(key);
    if (existing) {
      existing.total += amt;
    } else {
      map.set(key, { month, categorySlug: cat, total: amt });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.month === b.month ? a.categorySlug.localeCompare(b.categorySlug) : b.month.localeCompare(a.month)
  );
}

// Convenience: month-by-month net (income - expense) per view.
export type MonthlyNet = { month: string; net: number };

export function monthlyNet(txs: Tx[], view: "real" | "shared"): MonthlyNet[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.isTransfer) continue;
    const amt = view === "real" ? t.realAmount : t.sharedAmount;
    if (amt === 0) continue;
    const month = t.date.slice(0, 7);
    map.set(month, (map.get(month) ?? 0) + amt);
  }
  return Array.from(map.entries())
    .map(([month, net]) => ({ month, net }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
