"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  Eye,
  Pencil,
  SlidersHorizontal,
  ArrowRight,
  ExternalLink
} from "lucide-react";
import { formatBRL, formatInt } from "@/lib/format";

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

export function HistoricoClient({ rows }: { rows: ModRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted">
          Nenhuma modificação no período. Tudo que você ajustar aqui vai aparecer.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const meta = actionMeta[r.action];
        const Icon = meta.Icon;
        const isOpen = expanded.has(r.id);
        const isMerchant = r.scope === "merchant";
        const targetHref = isMerchant
          ? `/admin/merchants/${encodeURIComponent(r.targetId)}`
          : null; // single-tx clicks could go to inbox/edit later

        return (
          <li
            key={r.id}
            className={`rounded-2xl border transition ${
              r.reverted
                ? "bg-card/40 border-border/40 opacity-60"
                : "bg-card border-border"
            }`}
          >
            <button
              onClick={() => toggle(r.id)}
              className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-fg/[0.03] active:bg-fg/[0.06] transition rounded-2xl"
            >
              <div
                className={`shrink-0 w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center`}
              >
                <Icon size={16} className={meta.fg} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.bg} ${meta.fg}`}
                  >
                    {meta.label}
                  </span>
                  {r.scope === "merchant" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-fg/5 text-muted">
                      MERCHANT · {formatInt(r.affectedCount)}{" "}
                      {r.affectedCount === 1 ? "tx" : "tx"}
                    </span>
                  )}
                  <span className="text-[10px] text-muted ml-auto" title={fullTime(r.createdAt)}>
                    {relativeTime(r.createdAt)}
                  </span>
                </div>

                <p className="font-medium text-sm truncate" title={r.targetName}>
                  {r.targetName}
                </p>

                {/* Diff line */}
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  {r.action === "rename" ? (
                    <>
                      <span className="line-through truncate max-w-[40%]">
                        {r.beforeValue?.name ?? "—"}
                      </span>
                      <ArrowRight size={11} className="shrink-0" />
                      <span className="text-fg font-medium truncate max-w-[40%]">
                        {r.afterValue?.name ?? "—"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums">
                        {formatBRL(
                          r.beforeValue?.value ??
                            r.beforeValue?.total ??
                            0
                        )}
                      </span>
                      <ArrowRight size={11} className="shrink-0" />
                      <span
                        className={`tabular-nums font-medium ${
                          (r.afterValue?.value ?? r.afterValue?.total ?? 0) === 0
                            ? "text-warning"
                            : "text-fg"
                        }`}
                      >
                        {formatBRL(
                          r.afterValue?.value ?? r.afterValue?.total ?? 0
                        )}
                      </span>
                      {r.impactBrl != null && r.impactBrl !== 0 && (
                        <span
                          className={`ml-2 tabular-nums font-medium ${
                            r.impactBrl < 0 ? "text-danger" : "text-accent"
                          }`}
                        >
                          ({r.impactBrl > 0 ? "+" : ""}
                          {formatBRL(r.impactBrl)})
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-muted mt-2">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-border/60 text-xs space-y-3">
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
                  <DetailRow
                    label="Valor aplicado em cada tx"
                    value={formatBRL(r.afterValue.per_row_value)}
                  />
                )}

                <div className="pt-2 flex gap-2">
                  {targetHref && (
                    <Link
                      href={targetHref}
                      className="px-3 py-1.5 rounded-lg border border-border text-muted hover:text-fg hover:border-fg/30 transition text-[11px] flex items-center gap-1.5"
                    >
                      <ExternalLink size={11} /> Ir para o merchant
                    </Link>
                  )}
                  {r.reverted && (
                    <span className="text-[10px] text-muted self-center">
                      (revertido)
                    </span>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
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
