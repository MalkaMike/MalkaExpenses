import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import type { Role } from "@/lib/auth/admin";
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

export type AdminTxLite = TxLite & {
  real_amount: number;
  shared_amount: number;
  is_fake: boolean;
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

export async function getDashboardData(role: Role): Promise<DashboardData> {
  const sb = serverClient();

  // Accounts
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, real_starting_balance, shared_starting_balance, is_archived")
    .eq("is_archived", false);
  const accList = accounts ?? [];
  const accountsCount = accList.length;

  // Aggregate from the view (or table for admin) — fetch a single batch
  let txs: TxLite[] = [];
  let realStartingSum = 0;
  let sharedStartingSum = 0;
  for (const a of accList) {
    sharedStartingSum += fromDb(Number(a.shared_starting_balance));
    realStartingSum += fromDb(Number(a.real_starting_balance));
  }

  let totalRealAdj: number | null = null;
  if (role === "admin") {
    const { data } = await sb
      .from("transactions")
      .select(
        "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, category_id, is_transfer"
      )
      .eq("is_fake", false)
      .order("date", { ascending: false })
      .limit(5000);

    // Slug map
    const { data: cats } = await sb.from("categories").select("id, slug");
    const catMap = new Map<string, string>();
    for (const c of cats ?? []) catMap.set(c.id, c.slug);

    let realSum = 0;
    txs = (data ?? []).map((r) => {
      realSum += fromDb(Number(r.real_amount));
      return {
        id: r.id,
        account_id: r.account_id,
        date: r.date,
        description: r.description_clean ?? r.description_raw,
        amount: fromDb(Number(r.shared_amount)),
        category_slug: r.category_id ? catMap.get(r.category_id) ?? null : null,
        is_transfer: r.is_transfer
      };
    });
    totalRealAdj = realStartingSum + realSum;
  } else {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("id, account_id, date, description, amount, category_slug, is_transfer")
      .order("date", { ascending: false })
      .limit(5000);
    txs = (data ?? []).map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description ?? "",
      amount: fromDb(Number(r.amount)),
      category_slug: r.category_slug,
      is_transfer: r.is_transfer
    }));
  }

  const totalShared =
    sharedStartingSum + txs.reduce((s, t) => s + t.amount, 0);

  const thisYM = currentYearMonth();
  const prevYM = prevYearMonth();

  function monthAggregate(ym: string) {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (t.is_transfer) continue;
      if (!t.date.startsWith(ym)) continue;
      if (t.amount > 0) income += t.amount;
      else expense += -t.amount; // positive expense magnitude
    }
    return { income, expense, net: income - expense };
  }

  const thisMonth = monthAggregate(thisYM);
  const prevMonth = monthAggregate(prevYM);

  // By category this month (expenses only, magnitudes)
  const byCatMap = new Map<string, number>();
  for (const t of txs) {
    if (t.is_transfer) continue;
    if (!t.date.startsWith(thisYM)) continue;
    if (t.amount >= 0) continue;
    const slug = t.category_slug ?? "outros";
    byCatMap.set(slug, (byCatMap.get(slug) ?? 0) + -t.amount);
  }
  const byCategoryThisMonth = Array.from(byCatMap.entries())
    .map(([slug, total]) => ({ slug, total }))
    .sort((a, b) => b.total - a.total);

  // Monthly trend last 6 months
  const months = monthsBack(6);
  const monthlyTrend = months.map((m) => {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (t.is_transfer) continue;
      if (!t.date.startsWith(m)) continue;
      if (t.amount > 0) income += t.amount;
      else expense += -t.amount;
    }
    return { month: m, income, expense };
  });

  // Recent 8
  const recent = txs.slice(0, 8);

  return {
    accountsCount,
    totalShared,
    totalReal: totalRealAdj,
    thisMonth,
    prevMonth,
    byCategoryThisMonth,
    monthlyTrend,
    recent
  };
}
