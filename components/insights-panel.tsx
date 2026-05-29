import { TrendingUp, TrendingDown, AlertTriangle, Repeat, Star, Info } from "lucide-react";
import { getCategoryMeta } from "@/lib/categories/meta";
import type { Insight } from "@/lib/insights/engine";

const ICONS = {
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  alert: AlertTriangle,
  repeat: Repeat,
  star: Star,
  info: Info
} as const;

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="space-y-2">
      {insights.map((it) => {
        const Icon = ICONS[it.icon];
        const meta = it.categorySlug ? getCategoryMeta(it.categorySlug) : null;
        const accentColor =
          it.tone === "positive"
            ? "rgb(var(--accent))"
            : it.tone === "negative"
              ? "rgb(var(--danger))"
              : meta?.color ?? "rgb(var(--indigo))";

        return (
          <div
            key={it.id}
            className="flex gap-3 items-start p-3.5 rounded-xl border transition"
            style={{
              backgroundColor: `color-mix(in srgb, ${accentColor} 7%, rgb(var(--card)))`,
              borderColor: `color-mix(in srgb, ${accentColor} 22%, transparent)`
            }}
          >
            <div
              className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `color-mix(in srgb, ${accentColor} 16%, transparent)`,
                color: accentColor
              }}
            >
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight">{it.title}</p>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">{it.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
