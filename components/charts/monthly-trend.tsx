"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid
} from "recharts";
import { monthLabel, formatBRL } from "@/lib/format";

type Datum = { month: string; income: number; expense: number };

export function MonthlyTrend({ data }: { data: Datum[] }) {
  const labelled = data.map((d) => ({
    ...d,
    label: monthLabel(d.month)
  }));
  const hasData = data.some((d) => d.income > 0 || d.expense > 0);
  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted">
        Sem histórico ainda
      </div>
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={labelled} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="rgb(var(--muted))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="rgb(var(--muted))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "rgb(var(--card))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 8,
              fontSize: 12
            }}
            formatter={((v: unknown) => formatBRL(Number(v))) as never}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "rgb(var(--muted))" }}
            iconType="circle"
          />
          <Bar dataKey="income" name="Receita" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Despesa" fill="rgb(var(--danger))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
