import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatBRL } from "@/lib/format";

type Props = {
  label: string;
  value: number;
  previous?: number; // if provided, render a trend chip
  invertTrend?: boolean; // for "expense" KPIs (lower = better)
  tone?: "neutral" | "positive" | "negative";
  big?: boolean;
};

export function KpiCard({ label, value, previous, invertTrend, tone = "neutral", big }: Props) {
  let trend: { pct: number; up: boolean } | null = null;
  if (previous !== undefined && previous !== 0) {
    const pct = ((value - previous) / Math.abs(previous)) * 100;
    if (Math.abs(pct) >= 0.5) {
      trend = { pct, up: pct > 0 };
    }
  }

  const valueTone =
    tone === "positive" ? "text-accent" : tone === "negative" ? "text-danger" : "";

  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <p className={`tabular-nums font-semibold ${big ? "text-3xl" : "text-2xl"} ${valueTone}`}>
        {formatBRL(value)}
      </p>
      {trend && (
        <TrendChip
          pct={trend.pct}
          up={trend.up}
          better={invertTrend ? !trend.up : trend.up}
        />
      )}
      {!trend && previous !== undefined && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted">
          <Minus size={11} /> sem variação
        </p>
      )}
    </div>
  );
}

function TrendChip({ pct, up, better }: { pct: number; up: boolean; better: boolean }) {
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = better ? "text-accent" : "text-danger";
  return (
    <p className={`mt-1.5 inline-flex items-center gap-1 text-[11px] tabular-nums ${cls}`}>
      <Icon size={11} />
      {up ? "+" : ""}
      {pct.toFixed(1)}%
      <span className="text-muted ml-0.5">vs mês anterior</span>
    </p>
  );
}
