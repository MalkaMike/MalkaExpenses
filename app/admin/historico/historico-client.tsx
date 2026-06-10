"use client";
import { useState } from "react";
import Link from "next/link";
import {
  EyeOff,
  Eye,
  Pencil,
  SlidersHorizontal,
  ArrowRight,
  ExternalLink
} from "lucide-react";
import { formatBRL, formatInt } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";

export type ModRow = {
  id: string;
  createdAt: string;
  action: "hide" | "show" | "adjust" | "rename" | "category";
  scope: "transaction" | "merchant";
  targetId: string;
  targetName: string;
  field: string;
  beforeValue: {
    value?: number;
    total?: number;
    name?: string;
    rows?: number;
    per_row_value?: number;
  } | null;
  afterValue: {
    value?: number;
    total?: number;
    name?: string;
    rows?: number;
    per_row_value?: number;
  } | null;
  affectedCount: number;
  impactBrl: number | null;
  reverted: boolean;
};

const actionMeta: Record<
  ModRow["action"],
  { label: string; bg: string; fg: string; Icon: typeof EyeOff }
> = {
  hide: { label: "ESCONDIDO", bg: "bg-warning/15", fg: "text-warning", Icon: EyeOff },
  show: { label: "MOSTRADO", bg: "bg-accent/10", fg: "text-accent", Icon: Eye },
  adjust: { label: "AJUSTADO", bg: "bg-fg/10", fg: "text-fg", Icon: SlidersHorizontal },
  rename: { label: "RENOMEADO", bg: "bg-fg/5", fg: "text-muted", Icon: Pencil },
  category: { label: "CATEGORIA", bg: "bg-fg/5", fg: "text-muted", Icon: Pencil }
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function DiffCell({ r }: { r: ModRow }) {
  if (r.action === "rename") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted min-w-0">
        <span className="line-through truncate max-w-[100px]">{r.beforeValue?.name ?? "—"}</span>
        <ArrowRight size={11} className="shrink-0" />
        <span className="text-fg font-medium truncate max-w-[100px]">{r.afterValue?.name ?? "—"}</span>
      </span>
    );
  }
  const after = r.afterValue?.value ?? r.afterValue?.total ?? 0;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
      <span className="tabular-nums">{formatBRL(r.beforeValue?.value ?? r.beforeValue?.total ?? 0)}</span>
      <ArrowRight size={11} className="shrink-0" />
      <span className={`tabular-nums font-medium ${after === 0 ? "text-warning" : "text-fg"}`}>
        {formatBRL(after)}
      </span>
    </span>
  );
}

export function HistoricoClient({ rows }: { rows: ModRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const columns: Column<ModRow>[] = [
    {
      key: "when",
      header: "Quando",
      sortValue: (r) => r.createdAt,
      cell: (r) => (
        <span className="text-[11px] text-muted whitespace-nowrap" title={fullTime(r.createdAt)}>
          {relativeTime(r.createdAt)}
        </span>
      )
    },
    {
      key: "action",
      header: "Ação",
      sortValue: (r) => r.action,
      cell: (r) => {
        const meta = actionMeta[r.action];
        const Icon = meta.Icon;
        return (
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.bg} ${meta.fg} whitespace-nowrap`}>
            <Icon size={10} /> {meta.label}
          </span>
        );
      }
    },
    {
      key: "target",
      header: "Alvo",
      sortValue: (r) => r.targetName.toLowerCase(),
      cell: (r) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-sm truncate max-w-[220px]" title={r.targetName}>
            {r.targetName}
          </span>
          {r.scope === "merchant" && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-fg/5 text-muted shrink-0">MERCHANT</span>
          )}
        </span>
      )
    },
    {
      key: "diff",
      header: "Antes → depois",
      hideBelow: "sm",
      cell: (r) => <DiffCell r={r} />
    },
    {
      key: "affected",
      header: "Tx",
      align: "right",
      hideBelow: "md",
      sortValue: (r) => r.affectedCount,
      cell: (r) => <span className="tabular-nums text-[11px] text-muted">{formatInt(r.affectedCount)}</span>
    },
    {
      key: "impact",
      header: "Impacto",
      align: "right",
      sortValue: (r) => r.impactBrl ?? 0,
      cell: (r) =>
        r.impactBrl != null && r.impactBrl !== 0 ? (
          <span className={`tabular-nums text-xs font-medium whitespace-nowrap ${r.impactBrl < 0 ? "text-danger" : "text-accent"}`}>
            {r.impactBrl > 0 ? "+" : ""}
            {formatBRL(r.impactBrl)}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )
    }
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      defaultSort={{ key: "when", dir: "desc" }}
      onRowClick={(r) => setExpanded((cur) => (cur === r.id ? null : r.id))}
      expandedKey={expanded}
      rowClassName={(r) => (r.reverted ? "opacity-50 hover:bg-surface-container/30" : "hover:bg-surface-container/30")}
      renderExpanded={(r) => <ExpandedDetail r={r} />}
      empty={
        <div className="rounded-2xl bg-card border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted">
            Nenhuma modificação no período. Tudo que você ajustar aqui vai aparecer.
          </p>
        </div>
      }
    />
  );
}

function ExpandedDetail({ r }: { r: ModRow }) {
  const targetHref =
    r.scope === "merchant" ? `/admin/merchants/${encodeURIComponent(r.targetId)}` : null;
  return (
    <div className="text-xs space-y-3">
      <DetailRow label="Data" value={fullTime(r.createdAt)} />
      <DetailRow label="Tipo" value={r.scope === "merchant" ? "Cluster de merchant" : "Transação única"} />
      <DetailRow label="Campo" value={r.field} mono />
      {r.scope === "merchant" && (
        <DetailRow
          label="Transações afetadas"
          value={`${formatInt(r.affectedCount)} ${r.affectedCount === 1 ? "linha" : "linhas"}`}
        />
      )}
      {r.action === "adjust" && r.afterValue?.per_row_value != null && (
        <DetailRow label="Valor aplicado em cada tx" value={formatBRL(r.afterValue.per_row_value)} />
      )}
      <div className="pt-2 flex gap-2">
        {targetHref && (
          <Link
            href={targetHref}
            onClick={(e) => e.stopPropagation()}
            className="px-3 py-1.5 rounded-lg border border-border text-muted hover:text-fg hover:border-fg/30 transition text-[11px] flex items-center gap-1.5"
          >
            <ExternalLink size={11} /> Ir para o merchant
          </Link>
        )}
        {r.reverted && <span className="text-[10px] text-muted self-center">(revertido)</span>}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted w-32 shrink-0">
        {label}
      </span>
      <span className={`text-fg ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  );
}
