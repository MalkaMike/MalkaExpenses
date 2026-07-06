import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import type { Role } from "@/lib/auth/admin";
import type { AccountTxSums } from "@/lib/balance/queries";
import { fromDb } from "@/lib/money";

export type TxLite = {
  id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed
  category_slug: string | null;
  is_transfer: boolean;
};

export type DashboardData = {
  accountsCount: number;
  totalShared: number;
  totalReal: number | null;
  thisMonth: { income: number; expense: number; net: number };
  prevMonth: { income: number; expense: number; net: number };
  byCategoryThisMonth: Array<{ slug: string; total: number }>;
  monthlyTrend: Array<{ month: string; income: number; expense: number }>;
  recent: TxLite[];
};

// Row shape returned by the admin_monthly_summary() RPC (migration 0035).
type MonthlySummaryRow = {
  month: string; // YYYY-MM
  shared_income: number; // cents
  shared_expense: number; // cents
  real_income: number; // cents
  real_expense: number; // cents
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function prevYearMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function slugOf(cats: { slug: string } | { slug: string }[] | null): string | null {
  if (!cats) return null;
  return Array.isArray(cats) ? cats[0]?.slug ?? null : cats.slug;
}

// All sums come from SQL aggregates (migration 0035) instead of fetching raw
// rows and reducing in JS. The old implementation used .limit(5000), which
// PostgREST clamps to max_rows=1000 — with 5,645 live rows the net-worth
// hero and every KPI were computed over an arbitrary ~18% of the ledger.
export async function getDashboardData(role: Role): Promise<DashboardData> {
  const sb = serverClient();
  const thisYM = currentYearMonth();
  const prevYM = prevYearMonth();
  const thisMonthStart = `${thisYM}-01`;

  const accountsQ = sb
    .from("accounts")
    .select("id, real_starting_balance, shared_starting_balance, is_archived")
    .eq("is_archived", false);

  let accountsCount = 0;
  let realStartingSum = 0;
  let sharedStartingSum = 0;

  let totalReal: number | null = null;
  let totalShared = 0;
  let monthly: Array<{ month: string; income: number; expense: number }> = [];
  let byCategoryRaw: Array<{ slug: string | null; amount: number }> = [];
  let recent: TxLite[] = [];

  if (role === "admin") {
    const [accountsRes, summaryRes, sumsRes, recentRes, catRes] = await Promise.all([
      accountsQ,
      sb.rpc("admin_monthly_summary"),
      sb.rpc("account_tx_sums"),
      sb
        .from("transactions")
        .select(
          "id, account_id, date, description_raw, description_clean, shared_amount, is_transfer, categories(slug)"
        )
        .eq("is_fake", false)
        .order("date", { ascending: false })
        .limit(8),
      // Current month only — bounded (~100-200 rows), needed for the donut.
      sb
        .from("transactions")
        .select("shared_amount, categories(slug)")
        .eq("is_fake", false)
        .eq("is_transfer", false)
        .lt("shared_amount", 0)
        .gte("date", thisMonthStart)
    ]);
    if (accountsRes.error) throw accountsRes.error;
    if (summaryRes.error) throw summaryRes.error;
    if (sumsRes.error) throw sumsRes.error;
    if (recentRes.error) throw recentRes.error;
    if (catRes.error) throw catRes.error;

    const accList = accountsRes.data ?? [];
    accountsCount = accList.length;
    for (const a of accList) {
      sharedStartingSum += fromDb(Number(a.shared_starting_balance));
      realStartingSum += fromDb(Number(a.real_starting_balance));
    }

    let realSum = 0;
    let sharedSum = 0;
    for (const r of (sumsRes.data ?? []) as AccountTxSums[]) {
      realSum += fromDb(Number(r.real_total));
      sharedSum += fromDb(Number(r.shared_total));
    }
    totalReal = realStartingSum + realSum;
    totalShared = sharedStartingSum + sharedSum;

    monthly = ((summaryRes.data ?? []) as MonthlySummaryRow[]).map((m) => ({
      month: m.month,
      income: fromDb(Number(m.shared_income)),
      expense: fromDb(Number(m.shared_expense))
    }));

    byCategoryRaw = (catRes.data ?? []).map((r) => ({
      slug: slugOf(r.categories as { slug: string } | { slug: string }[] | null),
      amount: fromDb(Number(r.shared_amount))
    }));

    recent = (recentRes.data ?? []).map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description_clean ?? r.description_raw,
      amount: fromDb(Number(r.shared_amount)),
      category_slug: slugOf(r.categories as { slug: string } | { slug: string }[] | null),
      is_transfer: r.is_transfer
    }));
  } else {
    const sh = sharedClient();
    const [accountsRes, summaryRes, balancesRes, recentRes, catRes] = await Promise.all([
      accountsQ,
      sh.from("shared_monthly_summary_v").select("month, income, expense"),
      sh.from("shared_account_balances_v").select("account_id, total"),
      sh
        .from("shared_transactions_v")
        .select("id, account_id, date, description, amount, category_slug, is_transfer")
        .order("date", { ascending: false })
        .limit(8),
      sh
        .from("shared_transactions_v")
        .select("amount, category_slug")
        .eq("is_transfer", false)
        .lt("amount", 0)
        .gte("date", thisMonthStart)
    ]);
    if (accountsRes.error) throw accountsRes.error;
    if (summaryRes.error) throw summaryRes.error;
    if (balancesRes.error) throw balancesRes.error;
    if (recentRes.error) throw recentRes.error;
    if (catRes.error) throw catRes.error;

    const accList = accountsRes.data ?? [];
    accountsCount = accList.length;
    for (const a of accList) {
      sharedStartingSum += fromDb(Number(a.shared_starting_balance));
    }

    let sharedSum = 0;
    for (const r of balancesRes.data ?? []) {
      sharedSum += fromDb(Number(r.total));
    }
    totalShared = sharedStartingSum + sharedSum;

    monthly = (summaryRes.data ?? []).map((m) => ({
      month: m.month,
      income: fromDb(Number(m.income)),
      expense: fromDb(Number(m.expense))
    }));

    byCategoryRaw = (catRes.data ?? []).map((r) => ({
      slug: r.category_slug,
      amount: fromDb(Number(r.amount))
    }));

    recent = (recentRes.data ?? []).map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description ?? "",
      amount: fromDb(Number(r.amount)),
      category_slug: r.category_slug,
      is_transfer: r.is_transfer
    }));
  }

  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  function monthAggregate(ym: string) {
    const m = byMonth.get(ym);
    const income = m?.income ?? 0;
    const expense = m?.expense ?? 0;
    return { income, expense, net: income - expense };
  }

  const thisMonth = monthAggregate(thisYM);
  const prevMonth = monthAggregate(prevYM);

  // By category this month (expenses only, magnitudes)
  const byCatMap = new Map<string, number>();
  for (const r of byCategoryRaw) {
    const slug = r.slug ?? "outros";
    byCatMap.set(slug, (byCatMap.get(slug) ?? 0) + -r.amount);
  }
  const byCategoryThisMonth = Array.from(byCatMap.entries())
    .map(([slug, total]) => ({ slug, total }))
    .sort((a, b) => b.total - a.total);

  // Monthly trend last 6 months
  const monthlyTrend = monthsBack(6).map((m) => {
    const agg = byMonth.get(m);
    return { month: m, income: agg?.income ?? 0, expense: agg?.expense ?? 0 };
  });

  return {
    accountsCount,
    totalShared,
    totalReal,
    thisMonth,
    prevMonth,
    byCategoryThisMonth,
    monthlyTrend,
    recent
  };
}
