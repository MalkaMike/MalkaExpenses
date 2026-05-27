"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getCategoryMeta, getCategoryParent, CATEGORY_META } from "@/lib/categories/meta";
import { formatBRL } from "@/lib/format";
import { PieChart as PieIcon } from "lucide-react";

type Datum = { slug: string; total: number };

/**
 * Merge subcategories under their parent so the donut shows at most one slice
 * per parent (e.g. combustivel + uber_taxi + aereo → one "Transporte" slice).
 * Keeps top-level categories as-is.
 */
function mergeToParents(data: Datum[]): Datum[] {
  const merged = new Map<string, number>();
  for (const d of data) {
    const meta = CATEGORY_META[d.slug];
    const parentSlug = meta?.parentSlug ?? d.slug; // use parent slug if subcategory
    merged.set(parentSlug, (merged.get(parentSlug) ?? 0) + d.total);
  }
  // Convert back to array, sort by total desc
  return Array.from(merged.entries())
    .map(([slug, total]) => ({ slug, total }))
    .sort((a, b) => b.total - a.total);
}

export function CategoryDonut({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-36 gap-2 text-muted">
        <PieIcon size={28} className="opacity-20" />
        <p className="text-sm">Sem despesas este mês</p>
      </div>
    );
  }

  const merged = mergeToParents(data);
  const top = merged.slice(0, 7);
  const restTotal = merged.slice(7).reduce((s, d) => s + d.total, 0);
  const chartData = restTotal > 0 ? [...top, { slug: "outros", total: restTotal }] : top;

  return (
    <div className="relative">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="total"
              nameKey="slug"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
              strokeWidth={0}
            >
              {chartData.map((d, i) => {
                const meta = getCategoryMeta(d.slug);
                return <Cell key={i} fill={meta.color} />;
              })}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "rgb(var(--card))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 12
              }}
              formatter={((value: unknown, _name: unknown, item: unknown) => {
                const slug = (item as { payload?: { slug?: string } } | undefined)?.payload?.slug;
                const meta = getCategoryMeta(slug);
                const pct = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : "0";
                return [`${formatBRL(Number(value))} (${pct}%)`, meta.name];
              }) as never}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] uppercase tracking-wider text-muted">Total</span>
        <span className="text-xl font-semibold tabular-nums">{formatBRL(total)}</span>
        <span className="text-[10px] text-muted">{chartData.length} categorias</span>
      </div>
    </div>
  );
}
