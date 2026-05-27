import Link from "next/link";
import { ArrowRight, Plus, Upload, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { getRole } from "@/lib/auth/admin";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { getDashboardData } from "@/lib/dashboard/queries";
import { getInsights } from "@/lib/insights/engine";
import { formatBRL, monthLabel } from "@/lib/format";
import { TransactionRow } from "@/components/transaction-row";
import { KpiCard } from "@/components/kpi-card";
import { CategoryDonut } from "@/components/charts/category-donut";
import { MonthlyTrend } from "@/components/charts/monthly-trend";
import { CategoryChip } from "@/components/category-chip";
import { InsightsPanel } from "@/components/insights-panel";
import { mergeCategoryTotalsToParents } from "@/lib/categories/meta";

export const dynamic = "force-dynamic";

export default async function Home() {
  const role = await getRole();
  const [accounts, dash, insights] = await Promise.all([
    getAccountsWithBalances(role),
    getDashboardData(role),
    getInsights(role)
  ]);

  const empty = dash.accountsCount === 0;
  const noData = !empty && dash.recent.length === 0;
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <BrandLogo />
        <span className="text-xs text-muted">{monthLabel(ym)}</span>
      </header>

      {/* Hero balance */}
      <section className="rounded-2xl bg-gradient-to-br from-card to-card/40 border border-border p-5 mb-5">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Patrimônio total</p>
        <p className="text-4xl font-semibold tabular-nums">{formatBRL(dash.totalShared)}</p>
        {role === "admin" && dash.totalReal !== null && dash.totalReal !== dash.totalShared && (
          <p className="mt-1.5 text-xs text-muted tabular-nums">
            real: <span className="text-fg">{formatBRL(dash.totalReal)}</span>
            <span className="ml-2 opacity-70">
              Δ {formatBRL(dash.totalReal - dash.totalShared)}
            </span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-bg/60 border border-border">
            {dash.accountsCount} {dash.accountsCount === 1 ? "conta" : "contas"}
          </span>
          <Link
            href="/accounts/new"
            className="px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30 inline-flex items-center gap-1 hover:bg-accent/20"
          >
            <Plus size={12} /> nova conta
          </Link>
          {dash.accountsCount > 0 && (
            <Link
              href="/import"
              className="px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30 inline-flex items-center gap-1 hover:bg-accent/20"
            >
              <Upload size={12} /> importar
            </Link>
          )}
        </div>
      </section>

      {empty && (
        <EmptyOnboarding role={role} />
      )}

      {!empty && (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-3 gap-2.5 mb-5">
            <KpiCard
              label="Receita"
              value={dash.thisMonth.income}
              previous={dash.prevMonth.income}
              tone="positive"
            />
            <KpiCard
              label="Despesa"
              value={dash.thisMonth.expense}
              previous={dash.prevMonth.expense}
              tone="negative"
              invertTrend
            />
            <KpiCard label="Saldo do mês" value={dash.thisMonth.net} previous={dash.prevMonth.net} />
          </section>

          {/* Smart Facts */}
          {insights.length > 0 && (
            <section className="mb-5">
              <header className="flex items-center gap-2 mb-3 px-1">
                <Sparkles size={14} className="text-accent" />
                <h2 className="font-medium">Insights</h2>
              </header>
              <InsightsPanel insights={insights} />
            </section>
          )}

          {/* Category donut */}
          <section className="rounded-2xl bg-card border border-border p-5 mb-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Onde foi seu dinheiro</h2>
              <Link href="/categories" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
                ver todas <ArrowRight size={12} />
              </Link>
            </header>
            <CategoryDonut data={dash.byCategoryThisMonth} />
            <ul className="mt-4 space-y-1.5">
              {mergeCategoryTotalsToParents(dash.byCategoryThisMonth).slice(0, 5).map((c) => (
                <li key={c.slug} className="flex items-center justify-between text-sm">
                  <CategoryChip slug={c.slug} size="sm" />
                  <span className="tabular-nums font-medium">{formatBRL(c.total)}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Monthly trend */}
          <section className="rounded-2xl bg-card border border-border p-5 mb-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Últimos 6 meses</h2>
              <Link href="/months" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
                detalhes <ArrowRight size={12} />
              </Link>
            </header>
            <MonthlyTrend data={dash.monthlyTrend} />
          </section>

          {/* Accounts list */}
          <section className="mb-5">
            <h2 className="font-medium mb-3 px-1">Contas</h2>
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/accounts/${a.id}`}
                    className="flex items-center justify-between p-4 rounded-xl bg-card border border-border hover:border-accent/40 transition"
                  >
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted capitalize">
                        {a.bank} · {a.type === "credit_card" ? "cartão" : a.type === "checking" ? "corrente" : "poupança"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatBRL(a.sharedBalance)}</p>
                      {role === "admin" && a.realBalance !== null && a.realBalance !== a.sharedBalance && (
                        <p className="text-[11px] text-muted tabular-nums">
                          real {formatBRL(a.realBalance)}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Recent activity */}
          {dash.recent.length > 0 && (
            <section className="mb-8">
              <header className="flex items-center justify-between mb-3 px-1">
                <h2 className="font-medium">Movimentos recentes</h2>
                <Link
                  href="/transactions"
                  className="text-xs text-muted hover:text-fg inline-flex items-center gap-1"
                >
                  ver todos <ArrowRight size={12} />
                </Link>
              </header>
              <div className="space-y-2">
                {dash.recent.map((t) => (
                  <TransactionRow
                    key={t.id}
                    id={t.id}
                    date={t.date}
                    description={t.description}
                    amountShared={t.amount}
                    categorySlug={t.category_slug}
                    isTransfer={t.is_transfer}
                    role={role}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {noData && role === "admin" && (
        <div className="rounded-2xl bg-card border border-dashed border-border p-6 text-center mb-8">
          <p className="text-sm text-muted mb-3">Sem movimentos ainda.</p>
          <Link
            href="/import"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-fg text-bg text-sm font-medium"
          >
            <Upload size={14} /> Importar primeiro extrato
          </Link>
        </div>
      )}
    </div>
  );
}

function EmptyOnboarding({ role: _role }: { role: "public" | "household" | "admin" }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-accent/10 to-card border border-accent/30 p-6 mb-6">
      <h3 className="font-medium mb-1">Bem-vindo à Casa</h3>
      <p className="text-sm text-muted mb-4">
        Para começar: adicione suas contas e importe os extratos dos últimos meses.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          href="/accounts/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-fg text-bg text-sm font-medium"
        >
          <Plus size={14} /> Criar primeira conta
        </Link>
        <Link
          href="/import"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border text-sm font-medium"
        >
          <Upload size={14} /> Importar extrato
        </Link>
      </div>
    </div>
  );
}
