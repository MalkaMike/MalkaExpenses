import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { formatBRL, monthLabel } from "@/lib/format";
import { fromDb } from "@/lib/money";
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

  // Month aggregation happens in SQL (migration 0035). The old version
  // fetched every transaction row — PostgREST caps responses at 1000 rows,
  // so with 5,645+ live rows the older months silently lost data.
  let months: MonthRow[];
  if (role !== "admin") {
    const sb = sharedClient();
    const { data, error } = await sb
      .from("shared_monthly_summary_v")
      .select("month, income, expense");
    if (error) throw error;
    months = (data ?? [])
      .map((r) => {
        const income = fromDb(Number(r.income));
        const expense = fromDb(Number(r.expense));
        return { month: r.month as string, income, expense, net: income - expense };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  } else {
    const sb = serverClient();
    const { data, error } = await sb.rpc("admin_monthly_summary");
    if (error) throw error;
    type Row = {
      month: string;
      shared_income: number;
      shared_expense: number;
      real_income: number;
      real_expense: number;
    };
    months = ((data ?? []) as Row[])
      .map((r) => {
        const income = fromDb(Number(r.shared_income));
        const expense = fromDb(Number(r.shared_expense));
        return {
          month: r.month,
          income,
          expense,
          net: income - expense,
          realNet: fromDb(Number(r.real_income)) - fromDb(Number(r.real_expense))
        };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }

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
