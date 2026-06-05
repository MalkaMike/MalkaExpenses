"use client";
import { useState } from "react";
import { Paperclip, Loader2, ExternalLink, X, Check, RefreshCw, FileSearch, ShieldCheck, FileText, Eye } from "lucide-react";
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
  confidence: "verified" | "high";
  matchSource: "subject" | "snippet" | "email-body" | "pdf-text" | "vision-ocr" | "raw-text";
  matchReason: string;
  matchSnippet: string;
  confirmed?: boolean | null;
  gmailUrl: string;
};

type Props = {
  transactionId: string;
  merchantName: string;
  searched: boolean;
  matchCount: number;
};

// v2: value-verified receipt button. Only shows emails where the exact
// transaction amount was found (in subject, snippet, PDF text, or OCR).
//   - "verified" (green ShieldCheck) — value confirmed inside attached PDF/image
//   - "high" (blue Paperclip)        — value matched in email subject/preview
//   - empty (muted FileSearch)       — searched, nothing matched the value
export function ReceiptFinderButton({ transactionId, merchantName, searched, matchCount }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const effectiveCount = matches?.length ?? matchCount;
  const isEmpty = searched && effectiveCount === 0 && matches === null;
  const hasMatches = effectiveCount > 0;
  const hasVerified = matches?.some((m) => m.confidence === "verified") ?? false;
  const confirmedCount = matches?.filter((m) => m.confirmed === true).length ?? 0;

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
        if (r.status === 412) throw new Error("Gmail não conectado");
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
      /* optimistic */
    }
  }

  function handleClick() {
    setOpen((o) => !o);
    if (!open && hasMatches && matches === null) search(false);
  }

  const iconCls = busy
    ? "border-outline-variant text-on-surface-variant cursor-wait"
    : confirmedCount > 0
      ? "border-secondary/40 bg-secondary/5 text-secondary hover:bg-secondary/10"
      : hasVerified
        ? "border-secondary/30 bg-secondary/5 text-secondary hover:bg-secondary/10"
        : hasMatches
          ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          : isEmpty
            ? "border-outline-variant/40 text-on-surface-variant/40 hover:text-on-surface-variant"
            : "border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30";

  const iconTitle = busy
    ? "Buscando…"
    : confirmedCount > 0
      ? `${confirmedCount} nota fiscal confirmada`
      : hasVerified
        ? `${effectiveCount} nota fiscal verificada (valor exato em anexo)`
        : hasMatches
          ? `${effectiveCount} email com valor exato`
          : isEmpty
            ? "Nenhuma nota fiscal com este valor (já buscamos)"
            : "Buscar nota fiscal no Gmail";

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={busy}
        aria-label={iconTitle}
        title={iconTitle}
        className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition relative ${iconCls}`}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isEmpty ? (
          <FileSearch size={13} strokeWidth={1.5} />
        ) : hasVerified ? (
          <ShieldCheck size={14} />
        ) : confirmedCount > 0 ? (
          <Paperclip size={14} fill="currentColor" />
        ) : (
          <Paperclip size={14} />
        )}
        {hasMatches && !busy && (
          <span
            className={`absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums ${
              confirmedCount > 0 || hasVerified
                ? "bg-secondary text-on-secondary"
                : "bg-primary text-on-primary"
            }`}
          >
            {effectiveCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-96 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                {isEmpty ? "Nenhuma nota com este valor" : "Notas fiscais com valor exato"}
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
                <button onClick={() => setOpen(false)} className="p-1 hover:bg-surface-container-high rounded text-on-surface-variant">
                  <X size={12} />
                </button>
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto">
              {busy && !matches && (
                <div className="p-6 text-center">
                  <Loader2 size={20} className="animate-spin mx-auto text-on-surface-variant" />
                  <p className="text-xs text-on-surface-variant mt-2">Buscando + abrindo anexos…</p>
                  <p className="text-[10px] text-on-surface-variant/60 mt-1">Pode levar ~5-10 segundos</p>
                </div>
              )}
              {err && (
                <div className="p-4 bg-error-container/30 border-b border-outline-variant">
                  <p className="text-xs text-on-error-container">{err}</p>
                </div>
              )}
              {!busy && (matches?.length === 0 || isEmpty) && (
                <div className="p-6 text-center">
                  <FileSearch size={24} className="mx-auto text-on-surface-variant/40" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-on-surface-variant mt-2">
                    Nenhuma nota fiscal com este valor exato
                  </p>
                  <p className="text-[10px] text-on-surface-variant/70 mt-1.5 leading-relaxed">
                    Buscamos em ±7 dias usando várias variações do nome<br />
                    e abrimos os PDFs anexados para confirmar o valor
                  </p>
                  <button
                    onClick={() => search(true)}
                    className="mt-3 text-[10px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <RefreshCw size={10} /> Buscar novamente
                  </button>
                </div>
              )}
              {matches && matches.length > 0 && (
                <ul className="divide-y divide-outline-variant">
                  {matches.map((m) => {
                    const isVerified = m.confidence === "verified";
                    return (
                      <li key={m.gmailMessageId} className="p-3 hover:bg-surface-container transition">
                        {/* Confidence badge */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              isVerified
                                ? "bg-secondary text-on-secondary"
                                : "bg-primary/10 text-primary"
                            }`}
                          >
                            {isVerified ? <ShieldCheck size={10} /> : <FileText size={10} />}
                            {isVerified ? "Valor no anexo" : "Valor no email"}
                          </span>
                          {m.hasAttachment && (
                            <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                              <Paperclip size={10} />
                              {m.attachmentCount}
                            </span>
                          )}
                        </div>

                        {/* Subject */}
                        <p className="text-sm font-medium text-on-surface line-clamp-2 mb-1">{m.subject}</p>
                        {/* From + date */}
                        <p className="text-[11px] text-on-surface-variant truncate mb-2">
                          {m.fromName || m.fromEmail} · {formatDate(m.sentAt.slice(0, 10))}
                        </p>

                        {/* Match snippet — shows context around the value */}
                        {m.matchSnippet && (
                          <div className="mb-2 p-2 rounded bg-surface-container border border-outline-variant/50">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant mb-0.5">
                              {m.matchReason}
                            </p>
                            <p className="text-[11px] text-on-surface italic leading-relaxed">
                              {m.matchSnippet}
                            </p>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2">
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
                                title="Confirmado: esta é a nota correta"
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
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
