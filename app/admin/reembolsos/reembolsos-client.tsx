"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Send, X, Loader2, Trash2, RotateCcw } from "lucide-react";
import { formatBRL, formatDate, formatInt } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { safeJson } from "@/lib/http";

export type TagSummary = {
  pendingCount: number;
  pendingSum: number;
  reimbursedCount: number;
  reimbursedSum: number;
};

export type ReembolsoRow = {
  id: string;
  transactionId: string;
  status: "pending" | "submitted" | "reimbursed" | "declined";
  claimAmount: number;
  transactionAmount: number;
  submittedAt: string | null;
  reimbursedAt: string | null;
  notes: string | null;
  createdAt: string;
  description: string;
  date: string;
  accountName: string;
  categoryName: string;
};

// Status styling — Stitch palette
const statusMeta: Record<ReembolsoRow["status"], { label: string; dot: string; text: string }> = {
  pending:    { label: "Pendente",  dot: "bg-[#f59e0b]",  text: "text-[#f59e0b]"  },
  submitted:  { label: "Enviado",   dot: "bg-[#0ea5e9]",  text: "text-[#0ea5e9]"  },
  reimbursed: { label: "Recebido",  dot: "bg-[#006c49]",  text: "text-[#006c49]"  },
  declined:   { label: "Negado",    dot: "bg-[#ba1a1a]",  text: "text-[#ba1a1a]"  }
};

const STATUS_LABELS: Record<string, string> = {
  all: "Todas", pending: "Pendentes", submitted: "Enviadas", reimbursed: "Recebidas", declined: "Negadas"
};

// Sort order that follows the claim lifecycle, not the alphabet.
const STATUS_RANK: Record<ReembolsoRow["status"], number> = {
  pending: 0, submitted: 1, reimbursed: 2, declined: 3
};

function buildColumns(
  busy: string | null,
  setStatus: (id: string, status: ReembolsoRow["status"]) => void,
  untag: (id: string) => void
): Column<ReembolsoRow>[] {
  return [
    {
      key: "status",
      header: "Status",
      sortValue: (r) => STATUS_RANK[r.status],
      cell: (r) => {
        const meta = statusMeta[r.status];
        return (
          <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${meta.text}`}>
            <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        );
      }
    },
    {
      key: "date",
      header: "Data",
      sortValue: (r) => r.date,
      cell: (r) => <span className="text-[11px] text-on-surface-variant whitespace-nowrap">{formatDate(r.date)}</span>
    },
    {
      key: "description",
      header: "Descrição",
      sortValue: (r) => r.description.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-semibold text-sm text-on-surface truncate max-w-[260px]" title={r.description}>
            {r.description}
          </p>
          <p className="text-[10px] text-on-surface-variant truncate max-w-[260px]">
            {r.accountName} · {r.categoryName}
          </p>
          {r.notes && <p className="text-[10px] text-on-surface-variant italic truncate max-w-[260px]">{r.notes}</p>}
        </div>
      )
    },
    {
      key: "expense",
      header: "Despesa",
      align: "right",
      hideBelow: "md",
      sortValue: (r) => r.transactionAmount,
      cell: (r) => (
        <span className="tabular-nums text-xs text-on-surface font-medium whitespace-nowrap">
          {formatBRL(r.transactionAmount)}
        </span>
      )
    },
    {
      key: "claim",
      header: "A receber",
      align: "right",
      sortValue: (r) => r.claimAmount,
      cell: (r) => {
        const meta = statusMeta[r.status];
        return (
          <span className="whitespace-nowrap">
            <span className={`tabular-nums text-sm font-semibold ${meta.text}`}>{formatBRL(r.claimAmount)}</span>
            {r.claimAmount !== r.transactionAmount && (
              <span className="ml-1 text-[10px] text-[#f59e0b] font-medium">(parcial)</span>
            )}
          </span>
        );
      }
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      cell: (r) => {
        const isBusy = busy === r.id;
        return (
          <span className="inline-flex items-center gap-1">
            {r.status === "pending" && (
              <button
                onClick={() => setStatus(r.id, "submitted")}
                disabled={isBusy}
                title="Marcar como enviado"
                className="p-2 rounded-lg hover:bg-surface-container-highest transition-all active:scale-90 text-[#0ea5e9]"
              >
                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            )}
            {(r.status === "pending" || r.status === "submitted") && (
              <button
                onClick={() => setStatus(r.id, "reimbursed")}
                disabled={isBusy}
                title="Marcar como recebido"
                className="p-2 rounded-lg hover:bg-surface-container-highest transition-all active:scale-90 text-secondary"
              >
                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
            )}
            {r.status === "submitted" && (
              <button
                onClick={() => setStatus(r.id, "declined")}
                disabled={isBusy}
                title="Marcar como negado"
                className="p-2 rounded-lg hover:bg-surface-container-highest transition-all active:scale-90 text-error"
              >
                <X size={14} />
              </button>
            )}
            {(r.status === "reimbursed" || r.status === "declined") && (
              <button
                onClick={() => setStatus(r.id, "pending")}
                disabled={isBusy}
                title="Reabrir"
                className="p-2 rounded-lg hover:bg-surface-container-highest transition-all active:scale-90 text-on-surface-variant"
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              onClick={() => untag(r.id)}
              disabled={isBusy}
              title="Remover tag"
              className="p-2 rounded-lg hover:bg-surface-container-highest transition-all active:scale-90 text-on-surface-variant hover:text-error"
            >
              <Trash2 size={14} />
            </button>
          </span>
        );
      }
    }
  ];
}

export function ReembolsosClient({
  tagSlug, tagName, activeStatus, summary, rows
}: {
  tagSlug: string;
  tagName: string;
  activeStatus: "all" | "pending" | "submitted" | "reimbursed" | "declined";
  summary: TagSummary;
  rows: ReembolsoRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: ReembolsoRow["status"]) {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/reimbursements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? "Erro");
      }
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function untag(id: string) {
    if (!confirm("Remover esta despesa do " + tagName + "?")) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/reimbursements/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Erro");
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* Summary cards — Stitch entity card style */}
      <section className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
            Pendente / Enviado
          </p>
          <p className="text-2xl font-semibold tabular-nums text-[#f59e0b]">
            {formatBRL(summary.pendingSum)}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {formatInt(summary.pendingCount)} {summary.pendingCount === 1 ? "despesa aguardando" : "despesas aguardando"}
          </p>
          {/* Progress bar */}
          <div className="mt-3 h-1 w-full bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-[#f59e0b] transition-all duration-700"
              style={{ width: summary.pendingCount > 0 ? `${Math.min(100, (summary.pendingCount / Math.max(summary.pendingCount + summary.reimbursedCount, 1)) * 100)}%` : "0%" }}
            />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
            Já recebido
          </p>
          <p className="text-2xl font-semibold tabular-nums text-secondary">
            {formatBRL(summary.reimbursedSum)}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {formatInt(summary.reimbursedCount)} {summary.reimbursedCount === 1 ? "despesa reembolsada" : "despesas reembolsadas"}
          </p>
          <div className="mt-3 h-1 w-full bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary transition-all duration-700"
              style={{ width: summary.reimbursedCount > 0 ? "100%" : "0%" }}
            />
          </div>
        </div>
      </section>

      {/* Status filter — Stitch segmented control */}
      <div className="flex items-center bg-surface-container-high p-1 rounded-xl gap-0.5 mb-5">
        {(["all", "pending", "submitted", "reimbursed", "declined"] as const).map((s) => {
          const active = activeStatus === s;
          return (
            <Link
              key={s}
              href={`/admin/reembolsos?tag=${tagSlug}&status=${s}`}
              className={`flex-1 text-center px-2 py-2 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? "bg-surface-container-lowest shadow-sm text-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              {STATUS_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-xl bg-surface-container-lowest border border-dashed border-outline-variant p-12 text-center">
          <p className="text-sm text-on-surface-variant">
            Nenhuma despesa marcada com {tagName}.
          </p>
          <p className="text-xs text-on-surface-variant mt-2">
            Vá em{" "}
            <Link href="/admin/merchants?direction=out" className="text-secondary underline">
              Comerciantes
            </Link>{" "}
            → abra o merchant → clique no botão do tag.
          </p>
        </div>
      ) : (
        <>
          <DataTable
            columns={buildColumns(busy, setStatus, untag)}
            rows={rows}
            rowKey={(r) => r.id}
            defaultSort={{ key: "date", dir: "desc" }}
            rowClassName={(r) =>
              r.status === "declined" ? "bg-error/5 hover:bg-surface-container/30" : "hover:bg-surface-container/30"
            }
          />
          <p className="mt-2 px-1 text-xs text-on-surface-variant">
            {formatInt(rows.length)} {rows.length === 1 ? "despesa" : "despesas"}
          </p>
        </>
      )}
    </>
  );
}
