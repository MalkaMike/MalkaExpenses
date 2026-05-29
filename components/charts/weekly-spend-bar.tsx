"use client";

import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { formatBRL } from "@/lib/format";

export type WeekBar = { week: string; current: number; prev: number };

type TooltipPayloadItem = {
  name: string;
  value: unknown;
  color: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
};

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "rgb(var(--card))",
        border: "1px solid rgb(var(--border))",
        borderRadius: 8,
        fontSize: 12,
        padding: "8px 12px"
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4, color: "rgb(var(--fg))" }}>{label}</p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color, margin: "2px 0" }}>
          {item.name}: {formatBRL(Number(item.value))}
        </p>
      ))}
    </div>
  );
}

export function WeeklySpendBar({ data }: { data: WeekBar[] }) {
  const hasData = data.some((d) => d.current > 0 || d.prev > 0);
  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted">
        Sem dados para exibir
      </div>
    );
  }

  return (
    <div style={{ height: 192 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          barCategoryGap="30%"
          barGap={3}
        >
          <XAxis
            dataKey="week"
            stroke="rgb(var(--muted))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgb(var(--border))", opacity: 0.4 }}
          />
          <Bar
            dataKey="current"
            name="Este mês"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            dataKey="prev"
            name="Mês anterior"
            fill="#bbcabf"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
