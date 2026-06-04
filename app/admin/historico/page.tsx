import Link from "next/link";
import { ChevronLeft, EyeOff, Eye, Pencil, SlidersHorizontal, Filter } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { formatBRL, formatInt } from "@/lib/format";
import { HistoricoClient, type ModRow } from "./historico-client";

export const dynamic = "force-dynamic";

type ModRowDb = {
  id: string;
  created_at: string;
  action: "hide" | "show" | "adjust" | "rename" | "category";
  scope: "transaction" | "merchant";
  target_id: string;
  target_name: string;
  field: string;
  before_value: { value?: number; total?: number; name?: string; rows?: number; per_row_value?: number } | null;
  after_value: { value?: number; total?: number; name?: string; rows?: number; per_row_value?: number } | null;
  affected_count: number;
  impact_brl: number | null;
  reverted_at: string | null;
};

export default async function HistoricoPage({
  searchParams
}: {
  searchParams: Promise<{ filter?: string; period?: string }>;
}) {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const filter = (sp.filter ?? "all") as "all" | "hide" | "show" | "adjust" | "rename";
  const period = (sp.period ?? "30d") as "7d" | "30d" | "90d" | "all";

  const sb = serverClient();

  // Period filter
  const periodMap: Record<string, string | null> = {
    "7d": new Date(Date.now() - 7 * 86400000).toISOString(),
    "30d": new Date(Date.now() - 30 * 86400000).toISOString(),
    "90d": new Date(Date.now() - 90 * 86400000).toISOString(),
    all: null
  };
  const since = periodMap[period];

  let query = sb
    .from("admin_modifications")
    .select(
      "id, created_at, action, scope, target_id, target_name, field, before_value, after_value, affected_count, impact_brl, reverted_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (since) query = query.gte("created_at", since);
  if (filter !== "all") query = query.eq("action", filter);

  const { data, error } = await query;
  if (error) {
    return (
      <div className="px-4 pt-6 max-w-3xl mx-auto">
        <p className="text-sm text-danger">Erro carregando histórico: {error.message}</p>
      </div>
    );
  }
  const rows: ModRow[] = (data ?? []).map((r) => r as ModRowDb).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    action: r.action,
    scope: r.scope,
    targetId: r.target_id,
    targetName: r.target_name,
    field: r.field,
    beforeValue: r.before_value,
    afterValue: r.after_value,
    affectedCount: r.affected_count,
    impactBrl: r.impact_brl == null ? null : Number(r.impact_brl),
    reverted: r.reverted_at != null
  }));

  // Aggregate stats for the header
  const totalActions = rows.length;
  const totalHidden = rows.filter((r) => r.action === "hide").length;
  const totalAdjusted = rows.filter((r) => r.action === "adjust").length;
  const totalRenamed = rows.filter((r) => r.action === "rename").length;
  const totalImpact = rows.reduce(
    (s, r) => s + (r.impactBrl ?? 0),
    0
  );

  return (
    <div className="px-4 pt-6 max-w-3xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Histórico de modificações</h1>
        <p className="text-xs text-muted mt-1">
          Tudo que você mudou do que a Ayelet vê no portal compartilhado — em ordem reversa.
        </p>
      </header>

      {/* Stats grid */}
      <section className="grid grid-cols-4 gap-2 mb-5">
        <StatBox label="Ações" value={formatInt(totalActions)} />
        <StatBox label="Escondidas" value={formatInt(totalHidden)} tone="warning" />
        <StatBox label="Ajustadas" value={formatInt(totalAdjusted)} tone="accent" />
        <StatBox label="Renomeadas" value={formatInt(totalRenamed)} />
      </section>

      <section className="mb-5 p-3 rounded-xl bg-card border border-border flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Impacto total no portal (período)
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              totalImpact < 0 ? "text-danger" : totalImpact > 0 ? "text-accent" : ""
            }`}
          >
            {totalImpact > 0 ? "+" : ""}
            {formatBRL(totalImpact)}
          </p>
        </div>
        <p className="text-[10px] text-muted text-right max-w-[60%]">
          Quanto suas mudanças aumentaram ou diminuíram o que a Ayelet vê.
        </p>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChips current={filter} period={period} />
        <PeriodChips current={period} filter={filter} />
      </div>

      <HistoricoClient rows={rows} />
    </div>
  );
}

function StatBox({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "warning" | "accent";
}) {
  const color =
    tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent" : "text-fg";
  return (
    <div className="p-3 rounded-xl bg-card border border-border">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
    </div>
  );
}

function FilterChips({
  current,
  period
}: {
  current: string;
  period: string;
}) {
  const opts: { v: string; l: string; icon?: typeof EyeOff }[] = [
    { v: "all", l: "Tudo", icon: Filter },
    { v: "hide", l: "Escondidas", icon: EyeOff },
    { v: "show", l: "Mostradas", icon: Eye },
    { v: "adjust", l: "Ajustadas", icon: SlidersHorizontal },
    { v: "rename", l: "Renomeadas", icon: Pencil }
  ];
  return (
    <nav className="inline-flex p-1 rounded-xl bg-fg/[0.06] border border-border text-xs">
      {opts.map((o) => {
        const active = current === o.v;
        const Icon = o.icon ?? Filter;
        return (
          <Link
            key={o.v}
            href={`/admin/historico?filter=${o.v}&period=${period}`}
            className={`px-2.5 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 ${
              active ? "bg-fg text-bg" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={11} />
            {o.l}
          </Link>
        );
      })}
    </nav>
  );
}

function PeriodChips({
  current,
  filter
}: {
  current: string;
  filter: string;
}) {
  const opts = ["7d", "30d", "90d", "all"] as const;
  const labels: Record<string, string> = { "7d": "7d", "30d": "30d", "90d": "90d", all: "Tudo" };
  return (
    <nav className="inline-flex p-1 rounded-xl bg-fg/[0.06] border border-border text-xs ml-auto">
      {opts.map((o) => {
        const active = current === o;
        return (
          <Link
            key={o}
            href={`/admin/historico?filter=${filter}&period=${o}`}
            className={`px-2.5 py-1.5 rounded-lg transition font-medium ${
              active ? "bg-fg text-bg" : "text-muted hover:text-fg"
            }`}
          >
            {labels[o]}
          </Link>
        );
      })}
    </nav>
  );
}
