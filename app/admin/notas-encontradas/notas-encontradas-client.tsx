"use client";
import { useState } from "react";
import {
  Check, X, ExternalLink, Paperclip, ShieldCheck, FileText, Loader2, Inbox, CheckCheck
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";

export type FoundReceipt = {
  receiptId: string;
  gmailUrl: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  sentAt: string | null;
  hasAttachment: boolean;
  attachmentCount: number;
  confidence: string; // "verified" | "high"
  matchSource: string | null;
  matchSnippet: string | null;
  amountBrl: number | null;
  foundAt: string;
  txId: string;
  txDate: string;
  merchantName: string;
  txAmount: number;
  accountName: string;
};

export type DayGroup = { day: string; items: FoundReceipt[] };

const dayLabel = (d: string) => {
  // d = "YYYY-MM-DD" → "8 de jun"
  const [y, m, day] = d.split("-").map(Number);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${day} de ${months[(m ?? 1) - 1]} de ${y}`;
};

export function NotasEncontradasClient({ groups }: { groups: DayGroup[] }) {
  // Receipts the admin has triaged this session — hidden optimistically.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function markDone(ids: string[]) {
    setDone((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }
  function setRowBusy(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function triage(receiptId: string, confirmed: boolean) {
    setErr(null);
    setRowBusy(receiptId, true);
    try {
      const r = await fetch("/api/admin/gmail/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_id: receiptId, confirmed })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      markDone([receiptId]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRowBusy(receiptId, false);
    }
  }

  async function acceptDay(day: string, ids: string[]) {
    setErr(null);
    setBulkBusy(day);
    try {
      const r = await fetch("/api/admin/gmail/confirm-receipt/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_ids: ids, confirmed: true })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      markDone(ids);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  // Recompute visible groups after optimistic triage.
  const visibleGroups = groups
    .map((g) => ({ day: g.day, items: g.items.filter((it) => !done.has(it.receiptId)) }))
    .filter((g) => g.items.length > 0);

  const totalVisible = visibleGroups.reduce((s, g) => s + g.items.length, 0);

  if (totalVisible === 0) {
    return (
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-10 text-center">
        <Inbox size={28} className="mx-auto text-on-surface-variant/40" strokeWidth={1.5} />
        <p className="text-sm font-medium text-on-surface mt-3">Tudo revisado 🎉</p>
        <p className="text-xs text-on-surface-variant mt-1">
          Nenhuma nota fiscal nova pra revisar. O robô avisa aqui quando achar mais.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {err && (
        <div className="px-4 py-2.5 rounded-xl bg-error-container/40 border border-error text-sm text-on-error-container">
          {err}
        </div>
      )}

      {visibleGroups.map((g) => (
        <section key={g.day}>
          {/* Day header */}
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {dayLabel(g.day)} · {g.items.length} {g.items.length === 1 ? "nota" : "notas"}
            </h2>
            <button
              onClick={() => acceptDay(g.day, g.items.map((it) => it.receiptId))}
              disabled={bulkBusy === g.day}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-secondary/40 text-secondary hover:bg-secondary/5 text-[11px] font-medium transition disabled:opacity-40"
            >
              {bulkBusy === g.day ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCheck size={12} />
              )}
              Aceitar todas ({g.items.length})
            </button>
          </div>

          <ul className="space-y-2">
            {g.items.map((it) => {
              const isVerified = it.confidence === "verified";
              const rowBusy = busy.has(it.receiptId);
              return (
                <li
                  key={it.receiptId}
                  className="rounded-xl border border-outline-variant bg-surface-container-lowest soft-ambient-shadow overflow-hidden"
                >
                  <div className="p-3.5">
                    {/* Transaction line */}
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">{it.merchantName}</p>
                        <p className="text-[11px] text-on-surface-variant">
                          {formatDate(it.txDate)} · {it.accountName}
                        </p>
                      </div>
                      <span
                        className={`tabular-nums font-semibold shrink-0 text-sm ${
                          it.txAmount < 0 ? "text-on-tertiary-container" : "text-secondary"
                        }`}
                      >
                        {formatBRL(it.txAmount)}
                      </span>
                    </div>

                    {/* Receipt card */}
                    <div className="rounded-lg bg-surface-container border border-outline-variant/60 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                            isVerified ? "bg-secondary text-on-secondary" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {isVerified ? <ShieldCheck size={10} /> : <FileText size={10} />}
                          {isVerified ? "Valor no anexo" : "Valor no email"}
                        </span>
                        {it.hasAttachment && (
                          <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                            <Paperclip size={10} /> {it.attachmentCount}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] font-medium text-on-surface line-clamp-2">{it.subject}</p>
                      <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                        {it.fromName || it.fromEmail}
                        {it.sentAt ? ` · ${formatDate(it.sentAt.slice(0, 10))}` : ""}
                      </p>
                      {it.matchSnippet && (
                        <p className="text-[11px] text-on-surface italic mt-1.5 line-clamp-2 leading-relaxed">
                          {it.matchSnippet}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <a
                        href={it.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 text-[11px] font-medium flex items-center gap-1.5 transition"
                      >
                        <ExternalLink size={11} /> Abrir no Gmail
                      </a>
                      <div className="flex-1" />
                      <button
                        onClick={() => triage(it.receiptId, false)}
                        disabled={rowBusy}
                        title="Não é esta nota"
                        className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-error hover:border-error/40 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-40"
                      >
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        Descartar
                      </button>
                      <button
                        onClick={() => triage(it.receiptId, true)}
                        disabled={rowBusy}
                        title="Esta é a nota fiscal correta"
                        className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary hover:opacity-85 text-[11px] font-semibold flex items-center gap-1.5 transition disabled:opacity-40"
                      >
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Aceitar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
