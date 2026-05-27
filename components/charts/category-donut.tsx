"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getCategoryMeta } from "@/lib/categories/meta";
import { formatBRL } from "@/lib/format";

type Datum = { slug: string; total: number };

export function CategoryDonut({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted">
        Sem despesas este mês
      </div>
    );
  }
  const top = data.slice(0, 7);
  const rest = data.slice(7).reduce((s, d) => s + d.total, 0);
  const chartData = rest > 0 ? [...top, { slug: "outros_agrupados", total: rest }] : top;

  return (
    <div className="relative">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="total"
              nameKey="slug"
              innerRadius={70}
              outerRadius={100}
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
                return [formatBRL(Number(value)), getCategoryMeta(slug).name];
              }) as never}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xs uppercase tracking-wider text-muted">Total</span>
        <span className="text-xl font-semibold tabular-nums">{formatBRL(total)}</span>
      </div>
    </div>
  );
}
