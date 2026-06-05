"use client";
import { useState } from "react";
import { Paperclip, Loader2, ExternalLink, Search, X, Check, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/format";

type Match = {
  id?: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  sentAt: string;
  hasAttachment: boolean;
  attachmentCount: number;
  matchScore: number;
  matchReason: string;
  confirmed?: boolean | null;
  gmailUrl: string;
};

type Props = {
  transactionId: string;
  merchantName: string;
  /** If we already have cached matches, hand them in to avoid the initial fetch */
  initialMatches?: Match[];
};

// Per-transaction button that searches Gmail for matching nota fiscal /
// invoice emails, shows them in a popover, and opens the link in Gmail.
export function ReceiptFinderButton({ transactionId, merchantName, initialMatches }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(initialMatches ?? null);
  const [err, setErr] = useState<string | null>(null);
  const hasInitialMatches = !!initialMatches?.length;

  async function search(refresh = false) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/gmail/find-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId, merchant_name: merchantName, refresh })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 412) {
          throw new Error("Gmail não conectado. Vá em /admin para conectar.");
        }
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setMatches(j.matches ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmMatch(receiptId: string, confirmed: boolean | null) {
    try {
      await fetch("/api/admin/gmail/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_id: receiptId, confirmed })
      });
      setMatches((prev) =>
        prev?.map((m) => (m.id === receiptId ? { ...m, confirmed } : m)) ?? null
      );
    } catch {
      /* ignore — UI optimistic */
    }
  }

  const topMatch = matches?.[0];
  const confirmedCount = matches?.filter((m) => m.confirmed === true).length ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!matches && !open) search(false);
        }}
        disabled={busy}
        aria-label="Buscar nota fiscal no Gmail"
        title={hasInitialMatches ? `${matches?.length} resultado(s) — clique para abrir` : "Buscar nota fiscal no Gmail"}
        className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition
          ${busy
            ? "border-outline-variant text-on-surface-variant cursor-wait"
            : confirmedCount > 0
              ? "border-secondary/40 text-secondary hover:bg-secondary/5"
              : hasInitialMatches
                ? "border-primary/30 text-primary hover:bg-primary/5"
                : "border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30"}`}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : confirmedCount > 0 ? (
          <Paperclip size={14} fill="currentColor" />
        ) : (
          <Paperclip size={14} />
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Popover */}
          <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2.5 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Notas fiscais no Gmail
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => search(true)}
                  disabled={busy}
                  title="Buscar novamente"
                  className="p-1 hover:bg-surface-container-high rounded text-on-surface-variant"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 hover:bg-surface-container-high rounded text-on-surface-variant"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="max-h-96 overflow-y-auto">
              {busy && !matches && (
                <div className="p-6 text-center">
                  <Loader2 size={20} className="animate-spin mx-auto text-on-surface-variant" />
                  <p className="text-xs text-on-surface-variant mt-2">Buscando…</p>
                </div>
              )}
              {err && (
                <div className="p-4 bg-error-container/30 border-b border-outline-variant">
                  <p className="text-xs text-on-error-container">{err}</p>
                </div>
              )}
              {!busy && matches && matches.length === 0 && (
                <div className="p-6 text-center">
                  <Search size={20} className="mx-auto text-on-surface-variant opacity-50" />
                  <p className="text-xs text-on-surface-variant mt-2">
                    Nenhuma nota fiscal encontrada
                  </p>
                  <p className="text-[10px] text-on-surface-variant mt-1 opacity-70">
                    Buscamos ±3 dias da data desta transação
                  </p>
                </div>
              )}
              {matches && matches.length > 0 && (
                <ul className="divide-y divide-outline-variant">
                  {matches.map((m) => (
                    <li key={m.gmailMessageId} className="p-3 hover:bg-surface-container transition">
                      {/* Score + score reason */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                            m.matchScore >= 0.7
                              ? "bg-secondary-container text-on-secondary-container"
                              : m.matchScore >= 0.4
                                ? "bg-surface-container-high text-on-surface-variant"
                                : "bg-surface-container text-on-surface-variant"
                          }`}
                        >
                          {(m.matchScore * 100).toFixed(0)}%
                        </span>
                        {m.hasAttachment && (
                          <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                            <Paperclip size={10} />
                            {m.attachmentCount} anexo{m.attachmentCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      {/* Subject */}
                      <p className="text-sm font-medium text-on-surface line-clamp-2 mb-1">{m.subject}</p>
                      {/* From + date */}
                      <p className="text-[11px] text-on-surface-variant truncate">
                        {m.fromName || m.fromEmail} · {formatDate(m.sentAt.slice(0, 10))}
                      </p>
                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-2">
                        <a
                          href={m.gmailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:opacity-80 transition"
                        >
                          <ExternalLink size={11} /> Abrir no Gmail
                        </a>
                        {m.id && (
                          <>
                            <button
                              onClick={() => confirmMatch(m.id!, m.confirmed === true ? null : true)}
                              title="Esta é a nota fiscal correta"
                              className={`p-1.5 rounded-lg border transition ${
                                m.confirmed === true
                                  ? "bg-secondary text-on-secondary border-secondary"
                                  : "border-outline-variant text-on-surface-variant hover:border-secondary/40"
                              }`}
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={() => confirmMatch(m.id!, m.confirmed === false ? null : false)}
                              title="Não é esta"
                              className={`p-1.5 rounded-lg border transition ${
                                m.confirmed === false
                                  ? "bg-error/10 text-error border-error/40"
                                  : "border-outline-variant text-on-surface-variant hover:border-error/40"
                              }`}
                            >
                              <X size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
