import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { getCategoryMeta } from "@/lib/categories/meta";
import { formatBRL, monthLabel } from "@/lib/format";
import { getLang } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/translations";
import { BudgetsClient, type BudgetRow } from "./budgets-client";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const role = await getRole();
  const lang = await getLang();
  const sb = serverClient();

  const { data: budgets } = await sb
    .from("budgets")
    .select("id, category_id, monthly_limit, notes, categories(slug, name)")
    .order("monthly_limit", { ascending: false });

  // This month's spend per category from shared view (or table for admin)
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = `${ym}-01`;

  const catSpend = new Map<string, number>();
  if (role !== "admin") {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("amount, category_slug, is_transfer")
      .gte("date", start)
      .eq("is_transfer", false);
    for (const r of data ?? []) {
      if (Number(r.amount) >= 0) continue;
      const slug = r.category_slug ?? "outros";
      catSpend.set(slug, (catSpend.get(slug) ?? 0) + -Number(r.amount));
    }
  } else {
    const { data } = await sb
      .from("transactions")
      .select("shared_amount, is_transfer, categories(slug)")
      .gte("date", start)
      .eq("is_transfer", false);
    for (const r of (data ?? []) as {
      shared_amount: number;
      is_transfer: boolean;
      categories: { slug: string } | { slug: string }[] | null;
    }[]) {
      const amt = Number(r.shared_amount);
      if (amt >= 0) continue;
      const slug =
        (Array.isArray(r.categories) ? r.categories[0]?.slug : r.categories?.slug) ??
        "outros";
      catSpend.set(slug, (catSpend.get(slug) ?? 0) + -amt);
    }
  }

  const rows: BudgetRow[] = ((budgets ?? []) as {
    id: string;
    category_id: string;
    monthly_limit: number;
    notes: string | null;
    categories: { slug: string; name: string } | { slug: string; name: string }[] | null;
  }[]).map((b) => {
    const cat = Array.isArray(b.categories) ? b.categories[0] : b.categories;
    const slug = cat?.slug ?? "outros";
    const spent = catSpend.get(slug) ?? 0;
    const limit = Number(b.monthly_limit);
    return {
      id: b.id,
      categoryId: b.category_id,
      categorySlug: slug,
      categoryName: cat?.name ?? getCategoryMeta(slug).name,
      monthlyLimit: limit,
      spent,
      pct: limit > 0 ? Math.min(200, (spent / limit) * 100) : 0,
      notes: b.notes ?? null
    };
  });

  // Total over-budget
  const overBudget = rows.filter((r) => r.spent > r.monthlyLimit).length;
  const totalLimit = rows.reduce((s, r) => s + r.monthlyLimit, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">{t("budget.title", lang)}</h1>
        <p className="text-xs text-muted">
          {monthLabel(ym)} · {rows.length}{" "}
          {rows.length === 1 ? t("budget.cat_one_with_budget", lang) : t("budget.cat_many_with_budget", lang)}
        </p>
      </header>

      {rows.length > 0 && (
        <section className="grid grid-cols-2 gap-2 mb-5">
          <div className="p-3 rounded-xl bg-card border border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted">{t("budget.total_budgeted", lang)}</p>
            <p className="tabular-nums font-semibold">{formatBRL(totalLimit)}</p>
          </div>
          <div
            className={`p-3 rounded-xl border ${
              overBudget > 0
                ? "bg-danger/10 border-danger/30 text-danger"
                : "bg-card border-border"
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider opacity-80">{t("budget.already_spent", lang)}</p>
            <p className="tabular-nums font-semibold">{formatBRL(totalSpent)}</p>
          </div>
        </section>
      )}

      {overBudget > 0 && (
        <div className="mb-5 p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm">
          ⚠ {overBudget} {overBudget === 1 ? t("budget.over_one", lang) : t("budget.over_many", lang)}
        </div>
      )}

      <BudgetsClient rows={rows} canEdit={role === "admin"} />
    </div>
  );
}
