import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { formatBRL, monthLabel } from "@/lib/format";
import { MonthlyTrend } from "@/components/charts/monthly-trend";

export const dynamic = "force-dynamic";

type MonthRow = {
  month: string;
  income: number;
  expense: number;
  net: number;
  realNet?: number;
};

export default async function MonthsPage() {
  const role = await getRole();
  const monthMap = new Map<string, { income: number; expense: number; realIncome: number; realExpense: number }>();

  function add(m: string, income: number, expense: number, real: { income: number; expense: number } | null = null) {
    const cur = monthMap.get(m) ?? { income: 0, expense: 0, realIncome: 0, realExpense: 0 };
    cur.income += income;
    cur.expense += expense;
    if (real) {
      cur.realIncome += real.income;
      cur.realExpense += real.expense;
    }
    monthMap.set(m, cur);
  }

  if (role !== "admin") {
    const sb = sharedClient();
    const { data } = await sb
      .from("shared_transactions_v")
      .select("date, amount, is_transfer")
      .eq("is_transfer", false)
      .order("date", { ascending: false });
    for (const r of data ?? []) {
      const m = (r.date as string).slice(0, 7);
      const amt = Number(r.amount);
      if (amt > 0) add(m, amt, 0);
      else add(m, 0, -amt);
    }
  } else {
    const sb = serverClient();
    const { data } = await sb
      .from("transactions")
      .select("date, real_amount, shared_amount, is_transfer")
      .eq("is_fake", false)
      .eq("is_transfer", false)
      .order("date", { ascending: false });
    for (const r of data ?? []) {
      const m = (r.date as string).slice(0, 7);
      const sh = Number(r.shared_amount);
      const re = Number(r.real_amount);
      const shInc = sh > 0 ? sh : 0;
      const shExp = sh < 0 ? -sh : 0;
      const reInc = re > 0 ? re : 0;
      const reExp = re < 0 ? -re : 0;
      add(m, shInc, shExp, { income: reInc, expense: reExp });
    }
  }

  const months: MonthRow[] = Array.from(monthMap.entries())
    .map(([month, v]) => ({
      month,
      income: v.income,
      expense: v.expense,
      net: v.income - v.expense,
      realNet: role === "admin" ? v.realIncome - v.realExpense : undefined
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  // Last 12 months for the chart (ascending order)
  const trendChart = months
    .slice(0, 12)
    .map((m) => ({ month: m.month, income: m.income, expense: m.expense }))
    .reverse();

  // Stats
  const totalIncome = months.reduce((s, m) => s + m.income, 0);
  const totalExpense = months.reduce((s, m) => s + m.expense, 0);
  const avgIncome = months.length ? totalIncome / months.length : 0;
  const avgExpense = months.length ? totalExpense / months.length : 0;

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Meses</h1>
        <p className="text-xs text-muted">comparativo histórico</p>
      </header>

      {months.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted">Sem dados ainda.</div>
      ) : (
        <>
          <section className="rounded-2xl bg-card border border-border p-5 mb-5">
            <MonthlyTrend data={trendChart} />
          </section>

          <section className="grid grid-cols-2 gap-2 mb-5">
            <div className="p-3 rounded-xl bg-card border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted">Receita média</p>
              <p className="tabular-nums font-semibold text-accent">+{formatBRL(avgIncome)}</p>
            </div>
            <div className="p-3 rounded-xl bg-card border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted">Despesa média</p>
              <p className="tabular-nums font-semibold text-danger">-{formatBRL(avgExpense)}</p>
            </div>
          </section>

          <section className="space-y-2">
            {months.map((m) => (
              <Link
                key={m.month}
                href={`/transactions?month=${m.month}`}
                className="block p-4 rounded-xl bg-card border border-border hover:border-accent/40 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium capitalize">{monthLabel(m.month)}</span>
                  <div className="text-right">
                    <p className={`tabular-nums font-semibold ${m.net >= 0 ? "text-accent" : "text-danger"}`}>
                      {m.net >= 0 ? "+" : ""}
                      {formatBRL(m.net)}
                    </p>
                    {m.realNet !== undefined && m.realNet !== m.net && (
                      <p className="text-[10px] text-muted tabular-nums">
                        real {formatBRL(m.realNet)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-accent tabular-nums">+{formatBRL(m.income)}</span>
                  <span className="text-danger tabular-nums">-{formatBRL(m.expense)}</span>
                  <ChevronRight size={12} className="ml-auto text-muted" />
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
