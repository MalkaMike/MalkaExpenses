"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Send, X, Loader2, Trash2, RotateCcw } from "lucide-react";
import { formatBRL, formatDate, formatInt } from "@/lib/format";

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

const statusMeta: Record<
  ReembolsoRow["status"],
  { label: string; bg: string; fg: string }
> = {
  pending: { label: "PENDENTE", bg: "bg-warning/15", fg: "text-warning" },
  submitted: { label: "ENVIADO", bg: "bg-info/15", fg: "text-info" },
  reimbursed: { label: "RECEBIDO", bg: "bg-accent/15", fg: "text-accent" },
  declined: { label: "NEGADO", bg: "bg-danger/15", fg: "text-danger" }
};

export function ReembolsosClient({
  tagSlug,
  tagName,
  activeStatus,
  summary,
  rows
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
        const j = await r.json().catch(() => ({}));
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
      {/* Summary card */}
      <section className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-4 rounded-2xl bg-card border border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">
            Pendente / Enviado
          </p>
          <p className="text-2xl font-semibold tabular-nums text-warning">
            {formatBRL(summary.pendingSum)}
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            {formatInt(summary.pendingCount)}{" "}
            {summary.pendingCount === 1 ? "despesa aguardando" : "despesas aguardando"}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-card border border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">
            Já recebido
          </p>
          <p className="text-2xl font-semibold tabular-nums text-accent">
            {formatBRL(summary.reimbursedSum)}
          </p>
          <p className="text-[11px] text-muted mt-0.5">
            {formatInt(summary.reimbursedCount)}{" "}
            {summary.reimbursedCount === 1 ? "despesa reembolsada" : "despesas reembolsadas"}
          </p>
        </div>
      </section>

      {/* Status filter */}
      <nav className="inline-flex p-1 mb-4 rounded-xl bg-fg/[0.06] border border-border text-xs">
        {(["all", "pending", "submitted", "reimbursed", "declined"] as const).map((s) => {
          const labels: Record<string, string> = {
            all: "Todas",
            pending: "Pendentes",
            submitted: "Enviadas",
            reimbursed: "Recebidas",
            declined: "Negadas"
          };
          const active = activeStatus === s;
          return (
            <Link
              key={s}
              href={`/admin/reembolsos?tag=${tagSlug}&status=${s}`}
              className={`px-3 py-1.5 rounded-lg transition font-medium ${
                active ? "bg-fg text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {labels[s]}
            </Link>
          );
        })}
      </nav>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted">
            Nenhuma despesa marcada com {tagName}.
          </p>
          <p className="text-xs text-muted mt-2">
            Pra marcar: vá em <Link href="/admin/merchants?direction=out" className="text-accent underline">Comerciantes</Link>, abra o merchant, clique no botão do tag.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const meta = statusMeta[r.status];
            const isBusy = busy === r.id;
            return (
              <li
                key={r.id}
                className="p-4 rounded-2xl bg-card border border-border"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.bg} ${meta.fg}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-muted tabular-nums">
                        {formatDate(r.date)}
                      </span>
                      <span className="text-[10px] text-muted">·</span>
                      <span className="text-[10px] text-muted truncate">
                        {r.accountName}
                      </span>
                      <span className="text-[10px] text-muted">·</span>
                      <span className="text-[10px] text-muted">{r.categoryName}</span>
                    </div>
                    <p className="font-medium truncate" title={r.description}>
                      {r.description}
                    </p>
                    <div className="mt-1 flex items-baseline gap-2 text-xs">
                      <span className="text-muted">Despesa:</span>
                      <span className="tabular-nums">{formatBRL(r.transactionAmount)}</span>
                      <span className="text-muted ml-2">A receber:</span>
                      <span className="tabular-nums font-medium text-accent">
                        {formatBRL(r.claimAmount)}
                      </span>
                      {r.claimAmount !== r.transactionAmount && (
                        <span className="text-[10px] text-warning">(parcial)</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status transitions */}
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {r.status === "pending" && (
                    <button
                      onClick={() => setStatus(r.id, "submitted")}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg border border-info/40 text-info hover:bg-info/5 text-xs flex items-center gap-1.5"
                    >
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      Marcar enviado
                    </button>
                  )}
                  {(r.status === "pending" || r.status === "submitted") && (
                    <button
                      onClick={() => setStatus(r.id, "reimbursed")}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg border border-accent/40 text-accent hover:bg-accent/5 text-xs flex items-center gap-1.5"
                    >
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Recebido
                    </button>
                  )}
                  {r.status === "submitted" && (
                    <button
                      onClick={() => setStatus(r.id, "declined")}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg border border-danger/40 text-danger hover:bg-danger/5 text-xs flex items-center gap-1.5"
                    >
                      <X size={11} />
                      Negado
                    </button>
                  )}
                  {(r.status === "reimbursed" || r.status === "declined") && (
                    <button
                      onClick={() => setStatus(r.id, "pending")}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg border border-border text-muted hover:text-fg text-xs flex items-center gap-1.5"
                    >
                      <RotateCcw size={11} />
                      Reabrir
                    </button>
                  )}
                  <button
                    onClick={() => untag(r.id)}
                    disabled={isBusy}
                    className="ml-auto px-2.5 py-1.5 rounded-lg border border-border text-muted hover:text-danger hover:border-danger/30 text-xs flex items-center gap-1.5"
                    title="Remover esta tag da despesa"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                {r.notes && (
                  <p className="mt-2 text-xs text-muted italic">{r.notes}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
