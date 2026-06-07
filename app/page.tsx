import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { getRole } from "@/lib/auth/admin";
import { getAccountsWithBalances } from "@/lib/balance/queries";
import { getDashboardData } from "@/lib/dashboard/queries";
import { formatBRL, monthLabel } from "@/lib/format";
import { TransactionRow } from "@/components/transaction-row";
import { KpiCard } from "@/components/kpi-card";
import { CategoryDonut } from "@/components/charts/category-donut";
import { MonthlyTrend } from "@/components/charts/monthly-trend";
import { CategoryChip } from "@/components/category-chip";
import { mergeCategoryTotalsToParents } from "@/lib/categories/meta";
import { BankSquare } from "@/components/bank-square";
import { getLang } from "@/lib/i18n/server";
import { t, type Lang } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function Home() {
  const role = await getRole();
  const lang = await getLang();
  const [accounts, dash] = await Promise.all([
    getAccountsWithBalances(role),
    getDashboardData(role)
  ]);

  const empty = dash.accountsCount === 0;
  const noData = !empty && dash.recent.length === 0;
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // The admin's headline is their REAL net worth (the truth); the household's is
  // the shared/curated total. Avoids the admin seeing R$0 while items are staged.
  const heroTotal =
    role === "admin" && dash.totalReal !== null ? dash.totalReal : dash.totalShared;

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <BrandLogo />
        <span className="text-xs text-muted">{monthLabel(ym)}</span>
      </header>

      {/* Hero balance — Stitch large card */}
      <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant p-5 mb-5 soft-ambient-shadow">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">{t("home.total_net_worth", lang)}</p>
        <p
          className="text-4xl font-semibold tabular-nums"
          style={{ color: heroTotal >= 0 ? "#006c49" : "#ba1a1a" }}
        >
          {formatBRL(heroTotal)}
        </p>
        {dash.thisMonth.net !== 0 && (
          <p
            className="mt-1.5 text-sm tabular-nums font-semibold"
            style={{ color: dash.thisMonth.net > 0 ? "#006c49" : "#ba1a1a" }}
          >
            {dash.thisMonth.net > 0 ? "+" : "−"}
            {formatBRL(Math.abs(dash.thisMonth.net))}
            <span className="text-xs text-on-surface-variant font-normal ml-1.5">{t("home.this_month_short", lang)}</span>
          </p>
        )}
        {role === "admin" && dash.totalReal !== null && dash.totalReal !== dash.totalShared && (
          <p className="mt-1 text-xs text-on-surface-variant tabular-nums">
            portal Ayelet: <span className="text-on-surface font-medium">{formatBRL(dash.totalShared)}</span>
            <span className="ml-2 opacity-60">Δ {formatBRL(dash.totalReal - dash.totalShared)}</span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/accounts/new"
            className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium inline-flex items-center gap-2 hover:opacity-80 active:scale-[0.99] transition"
          >
            <Plus size={16} /> {t("home.new_account", lang)}
          </Link>
          <span className="ml-auto text-xs text-on-surface-variant">
            {dash.accountsCount} {dash.accountsCount === 1 ? t("home.account_one", lang) : t("home.account_many", lang)}
          </span>
        </div>
      </section>

      {empty && (
        <EmptyOnboarding role={role} lang={lang} />
      )}

      {!empty && (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-3 gap-2.5 mb-5">
            <KpiCard
              label={t("home.kpi_income", lang)}
              value={dash.thisMonth.income}
              previous={dash.prevMonth.income}
              tone="positive"
              noChangeLabel={t("kpi.no_change", lang)}
              vsPreviousLabel={t("kpi.vs_previous", lang)}
            />
            <KpiCard
              label={t("home.kpi_expense", lang)}
              value={dash.thisMonth.expense}
              previous={dash.prevMonth.expense}
              tone="negative"
              invertTrend
              noChangeLabel={t("kpi.no_change", lang)}
              vsPreviousLabel={t("kpi.vs_previous", lang)}
            />
            <KpiCard
              label={t("home.kpi_net", lang)}
              value={dash.thisMonth.net}
              previous={dash.prevMonth.net}
              noChangeLabel={t("kpi.no_change", lang)}
              vsPreviousLabel={t("kpi.vs_previous", lang)}
            />
          </section>


          {/* Category donut */}
          <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant p-5 mb-5 soft-ambient-shadow">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-medium">{t("home.where_money", lang)}</h2>
              <Link href="/categories" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
                {t("home.see_all_f", lang)} <ArrowRight size={12} />
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
          <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant p-5 mb-5 soft-ambient-shadow">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-medium">{t("home.last_6_months", lang)}</h2>
              <Link href="/months" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
                {t("home.details", lang)} <ArrowRight size={12} />
              </Link>
            </header>
            <MonthlyTrend data={dash.monthlyTrend} />
          </section>

          {/* Accounts list */}
          <section className="mb-5">
            <h2 className="font-medium mb-3 px-1">{t("home.accounts_heading", lang)}</h2>
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/accounts/${a.id}`}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <BankSquare bank={a.bank} size={40} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{a.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <AccountTypeBadge type={a.type} lang={lang} />
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
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

          {/* Recent activity — Stitch table card */}
          {dash.recent.length > 0 && (
            <section className="mb-8">
              <header className="flex items-center justify-between mb-3 px-1">
                <h2 className="font-semibold text-on-surface">{t("home.recent", lang)}</h2>
                <Link
                  href="/transactions"
                  className="text-xs text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1"
                >
                  {t("home.see_all_m", lang)} <ArrowRight size={12} />
                </Link>
              </header>
              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden soft-ambient-shadow divide-y divide-outline-variant">
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
        <div className="rounded-2xl bg-surface-container-lowest border border-dashed border-outline-variant p-6 text-center mb-8">
          <p className="text-sm text-on-surface-variant mb-3">{t("home.no_tx_yet", lang)}</p>
        </div>
      )}
    </div>
  );
}

function AccountTypeBadge({ type, lang }: { type: string; lang: Lang }) {
  const map: Record<string, { label: string; cls: string }> = {
    credit_card: { label: t("acct_type.credit_card_badge", lang), cls: "bg-warning/15 text-warning" },
    checking:    { label: t("acct_type.checking_badge", lang),    cls: "bg-accent/15  text-accent"  },
    savings:     { label: t("acct_type.savings_badge", lang),     cls: "bg-fg/10      text-muted"   },
  };
  const { label, cls } = map[type] ?? { label: type, cls: "bg-fg/10 text-muted" };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function EmptyOnboarding({ role: _role, lang }: { role: "public" | "household" | "admin" | "health" | "secretary"; lang: Lang }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-accent/10 to-card border border-accent/30 p-6 mb-6">
      <h3 className="font-medium mb-1">{t("home.welcome", lang)}</h3>
      <p className="text-sm text-muted mb-4">
        {t("home.onboarding", lang)}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          href="/accounts/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-fg text-bg text-sm font-medium"
        >
          <Plus size={14} /> {t("home.create_first", lang)}
        </Link>
      </div>
    </div>
  );
}
