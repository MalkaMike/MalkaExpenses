import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/queries";
import { CategoryDonut } from "@/components/charts/category-donut";
import { CategoryIcon } from "@/components/category-chip";
import { CategoryTreeEditor, type DbCategory } from "@/components/category-tree-editor";
import { getCategoryMeta, mergeCategoryTotalsToParents } from "@/lib/categories/meta";
import { formatBRL, monthLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const role = await getRole();
  const sb = serverClient();

  const [dash, { data: allCats }] = await Promise.all([
    getDashboardData(role),
    sb
      .from("categories")
      .select("id, slug, name, icon, color, parent_id")
      .order("sort_order")
  ]);

  // Merge subcategories into parents for the breakdown list (matches the donut)
  const mergedCategories = mergeCategoryTotalsToParents(dash.byCategoryThisMonth);
  const total = mergedCategories.reduce((s, c) => s + c.total, 0);
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Categorias</h1>
        <p className="text-xs text-muted">despesas em {monthLabel(ym)}</p>
      </header>

      <section className="rounded-2xl bg-card border border-border p-5 mb-5">
        <CategoryDonut data={dash.byCategoryThisMonth} />
      </section>

      <section className="space-y-2 mb-8">
        {mergedCategories.length === 0 && (
          <p className="text-sm text-muted text-center py-12">
            Sem despesas este mês.
          </p>
        )}
        {mergedCategories.map((c) => {
          const meta = getCategoryMeta(c.slug);
          const pct = total > 0 ? (c.total / total) * 100 : 0;
          return (
            <Link
              key={c.slug}
              href={`/transactions?cat=${c.slug}`}
              className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-accent/40 transition group"
            >
              <CategoryIcon slug={c.slug} size={20} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-medium">{meta.name}</p>
                  <p className="tabular-nums font-semibold">{formatBRL(c.total)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-bg overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: meta.color }}
                    />
                  </div>
                  <span className="text-[11px] text-muted tabular-nums w-12 text-right">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <ArrowRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition" />
            </Link>
          );
        })}
      </section>

      {/* Admin-only category tree editor */}
      {role === "admin" && (
        <CategoryTreeEditor categories={(allCats ?? []) as DbCategory[]} />
      )}
    </div>
  );
}
