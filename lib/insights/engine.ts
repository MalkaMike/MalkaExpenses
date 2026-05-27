import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { getCategoryMeta } from "@/lib/categories/meta";
import type { Role } from "@/lib/auth/admin";

// ============================================================================
// Smart Facts — rule-based insights generated from current data.
// Returns 3-8 prioritized insights for display on the dashboard / insights page.
// ============================================================================

export type Insight = {
  id: string;
  tone: "positive" | "negative" | "neutral";
  icon: "trending-up" | "trending-down" | "alert" | "repeat" | "star" | "info";
  title: string;
  body: string;
  // Optional category to highlight visually
  categorySlug?: string;
  // Sort priority — lower = higher
  priority: number;
};

type Tx = {
  date: string;
  amount: number;
  category_slug: string | null;
  description: string;
  is_transfer: boolean;
};

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function prevMonth(curr: string): string {
  const [y, m] = curr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return ym(d);
}

export async function getInsights(role: Role): Promise<Insight[]> {
  const sb = serverClient();
  const insights: Insight[] = [];

  // Fetch all relevant tx in last 90 days
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const sinceIso = since.toISOString().slice(0, 10);

  let txs: Tx[] = [];
  if (role !== "admin") {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("date, amount, category_slug, description, is_transfer")
      .gte("date", sinceIso);
    txs = ((data ?? []) as Tx[]).filter((t) => !t.is_transfer);
  } else {
    const { data } = await sb
      .from("transactions")
      .select("date, shared_amount, is_transfer, description_clean, description_raw, categories(slug)")
      .gte("date", sinceIso);
    txs = (data ?? []).map((r: {
      date: string;
      shared_amount: number;
      is_transfer: boolean;
      description_clean: string | null;
      description_raw: string;
      categories: { slug: string } | { slug: string }[] | null;
    }) => ({
      date: r.date,
      amount: Number(r.shared_amount),
      is_transfer: r.is_transfer,
      description: r.description_clean ?? r.description_raw,
      category_slug: Array.isArray(r.categories) ? r.categories[0]?.slug ?? null : r.categories?.slug ?? null
    })).filter((t) => !t.is_transfer);
  }

  const now = new Date();
  const thisYM = ym(now);
  const prevYM = prevMonth(thisYM);

  // --------------- 1. Biggest expense this month ---------------
  const thisMonth = txs.filter((t) => t.date.startsWith(thisYM) && t.amount < 0);
  if (thisMonth.length > 0) {
    const biggest = thisMonth.reduce((max, t) => (t.amount < max.amount ? t : max));
    insights.push({
      id: "biggest-expense",
      tone: "neutral",
      icon: "info",
      title: `Maior despesa do mês: ${biggest.description}`,
      body: `Você gastou ${formatBRL(-biggest.amount)} em ${formatBRL(-biggest.amount)} em uma única transação.`.replace(
        ` em ${formatBRL(-biggest.amount)}`,
        ""
      ),
      categorySlug: biggest.category_slug ?? undefined,
      priority: 30
    });
  }

  // --------------- 2. Per-category MoM comparison ---------------
  const catThis = new Map<string, number>();
  const catPrev = new Map<string, number>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const slug = t.category_slug ?? "outros";
    if (t.date.startsWith(thisYM)) catThis.set(slug, (catThis.get(slug) ?? 0) + -t.amount);
    else if (t.date.startsWith(prevYM)) catPrev.set(slug, (catPrev.get(slug) ?? 0) + -t.amount);
  }
  for (const [slug, thisVal] of catThis.entries()) {
    const prevVal = catPrev.get(slug) ?? 0;
    if (prevVal < 50) continue; // skip noisy small categories
    if (thisVal < 50) continue;
    const pct = ((thisVal - prevVal) / prevVal) * 100;
    if (Math.abs(pct) < 20) continue;
    const meta = getCategoryMeta(slug);
    insights.push({
      id: `mom-${slug}`,
      tone: pct > 0 ? "negative" : "positive",
      icon: pct > 0 ? "trending-up" : "trending-down",
      title:
        pct > 0
          ? `${meta.name}: gastando ${pct.toFixed(0)}% mais que no mês anterior`
          : `${meta.name}: gastando ${(-pct).toFixed(0)}% menos que no mês anterior`,
      body: `${formatBRL(thisVal)} este mês vs ${formatBRL(prevVal)} no anterior.`,
      categorySlug: slug,
      priority: pct > 50 ? 10 : 20
    });
  }

  // --------------- 3. Recurring detection ---------------
  // Group by normalized merchant token, look for monthly cadence in last 90d
  const byMerchant = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const key = t.description.replace(/\d/g, "").trim().slice(0, 30).toLowerCase();
    if (!key || key.length < 3) continue;
    const arr = byMerchant.get(key) ?? [];
    arr.push(t);
    byMerchant.set(key, arr);
  }
  const recurring: Array<{ merchant: string; monthlyAvg: number; count: number; categorySlug: string | null }> = [];
  for (const [merchant, occurrences] of byMerchant.entries()) {
    if (occurrences.length < 2) continue;
    // sort by date
    occurrences.sort((a, b) => a.date.localeCompare(b.date));
    // Check that gaps are roughly 25-35 days
    const gaps: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      const a = new Date(occurrences[i - 1].date);
      const b = new Date(occurrences[i].date);
      gaps.push((b.getTime() - a.getTime()) / 86400000);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap < 22 || avgGap > 38) continue;
    // Similar amounts (within 25%)
    const amts = occurrences.map((o) => -o.amount);
    const meanAmt = amts.reduce((s, a) => s + a, 0) / amts.length;
    const variance = Math.max(...amts) - Math.min(...amts);
    if (variance / meanAmt > 0.25) continue;
    recurring.push({
      merchant: occurrences[0].description.slice(0, 40),
      monthlyAvg: meanAmt,
      count: occurrences.length,
      categorySlug: occurrences[0].category_slug
    });
  }
  if (recurring.length > 0) {
    const total = recurring.reduce((s, r) => s + r.monthlyAvg, 0);
    insights.push({
      id: "recurring",
      tone: "neutral",
      icon: "repeat",
      title: `${recurring.length} cobranças recorrentes detectadas`,
      body: `Total mensal: ${formatBRL(total)}. Principais: ${recurring.slice(0, 3).map((r) => r.merchant).join(", ")}.`,
      priority: 25
    });
  }

  // --------------- 4. Top category ---------------
  if (catThis.size > 0) {
    const [topSlug, topVal] = [...catThis.entries()].sort((a, b) => b[1] - a[1])[0];
    const meta = getCategoryMeta(topSlug);
    const total = Array.from(catThis.values()).reduce((s, v) => s + v, 0);
    const pct = (topVal / total) * 100;
    insights.push({
      id: "top-category",
      tone: "neutral",
      icon: "star",
      title: `Maior categoria: ${meta.name}`,
      body: `${formatBRL(topVal)} este mês (${pct.toFixed(0)}% das despesas).`,
      categorySlug: topSlug,
      priority: 15
    });
  }

  // --------------- 5. Income vs Expense health ---------------
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (!t.date.startsWith(thisYM)) continue;
    if (t.amount > 0) income += t.amount;
    else expense += -t.amount;
  }
  if (income > 0 && expense > 0) {
    const savings = income - expense;
    const rate = (savings / income) * 100;
    insights.push({
      id: "savings-rate",
      tone: savings >= 0 ? "positive" : "negative",
      icon: savings >= 0 ? "trending-up" : "alert",
      title:
        savings >= 0
          ? `Você está poupando ${rate.toFixed(0)}% da renda este mês`
          : `Despesas excedem receitas em ${formatBRL(-savings)}`,
      body:
        savings >= 0
          ? `Receita: ${formatBRL(income)} · Despesa: ${formatBRL(expense)} · Sobra: ${formatBRL(savings)}.`
          : `Receita: ${formatBRL(income)} · Despesa: ${formatBRL(expense)}.`,
      priority: 5
    });
  }

  return insights.sort((a, b) => a.priority - b.priority).slice(0, 8);
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
