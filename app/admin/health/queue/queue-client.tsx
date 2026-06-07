"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Clock, Send, Loader2, AlertTriangle } from "lucide-react";
import { formatDate } from "@/lib/format";

type Claim = {
  id: string;
  lifecycle_state: string;
  sent_to_secretary_at: string | null;
  updated_at: string | null;
  provider_name: string | null;
  patient_name: string | null;
  emission_date: string | null;
};

const STATE_META: Record<string, { label: string; cls: string }> = {
  sent_to_secretary:    { label: "Aguardando confirmação", cls: "text-[#f59e0b]" },
  received_by_secretary:{ label: "Recebido",               cls: "text-primary" },
  sent_by_secretary:    { label: "Enviado ao seguro",       cls: "text-[#10b981]" },
};

function fmtDate(s: string | null | undefined) {
  return s ? formatDate(s.slice(0, 10)) : "—";
}

function ClaimCard({
  claim,
  onConfirmReceived,
  onConfirmSent,
}: {
  claim: Claim;
  onConfirmReceived: (id: string) => Promise<void>;
  onConfirmSent: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const meta = STATE_META[claim.lifecycle_state] ?? STATE_META.sent_to_secretary;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try { await fn(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-4 rounded-xl border border-outline-variant bg-surface-container-lowest space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface truncate">
            {claim.provider_name ?? "—"}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-on-surface-variant">{fmtDate(claim.emission_date)}</span>
            {claim.patient_name && (
              <span className="text-[10px] text-on-surface-variant">· {claim.patient_name}</span>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-semibold shrink-0 ${meta.cls}`}>{meta.label}</span>
      </div>

      {/* Sent-at info */}
      {claim.sent_to_secretary_at && (
        <p className="text-[10px] text-on-surface-variant">
          Email enviado em {fmtDate(claim.sent_to_secretary_at)} — verifique a sua caixa de entrada
        </p>
      )}

      {/* 3-part completeness reminder */}
      <div className="flex items-center gap-3 text-[10px] text-[#10b981]">
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> Pagamento</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> NF/Recibo</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> Pedido médico</span>
      </div>

      {/* Actions */}
      {claim.lifecycle_state === "sent_to_secretary" && (
        <button
          onClick={() => act(() => onConfirmReceived(claim.id))}
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-primary/10 text-primary font-semibold text-sm hover:bg-primary/15 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Confirmar que recebi os documentos
        </button>
      )}
      {claim.lifecycle_state === "received_by_secretary" && (
        <button
          onClick={() => act(() => onConfirmSent(claim.id))}
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-[#10b981]/10 text-[#10b981] font-semibold text-sm hover:bg-[#10b981]/15 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Confirmar que enviei ao seguro
        </button>
      )}
      {claim.lifecycle_state === "sent_by_secretary" && (
        <div className="flex items-center gap-2 text-[11px] text-[#10b981]">
          <CheckCircle2 size={12} />
          <span>Enviado ao seguro em {fmtDate(claim.updated_at)}</span>
        </div>
      )}

      {err && (
        <p className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {err}
        </p>
      )}
    </div>
  );
}

export function QueueClient() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/health/queue")
      .then((r) => r.json())
      .then((d) => setClaims(d.claims ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirmReceived(id: string) {
    const r = await fetch(`/api/admin/health/claims/${id}/confirm-received`, { method: "POST" });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "erro"); }
    load();
  }

  async function confirmSent(id: string) {
    const r = await fetch(`/api/admin/health/claims/${id}/confirm-sent`, { method: "POST" });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "erro"); }
    load();
  }

  const pending = claims.filter((c) => c.lifecycle_state === "sent_to_secretary");
  const received = claims.filter((c) => c.lifecycle_state === "received_by_secretary");
  const done = claims.filter((c) => c.lifecycle_state === "sent_by_secretary");

  return (
    <>
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={22} className="animate-spin text-on-surface-variant" />
        </div>
      )}

      {!loading && claims.length === 0 && (
        <div className="text-center py-16 text-sm text-on-surface-variant">
          Nenhum processo em fila no momento.
        </div>
      )}

      {!loading && pending.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-[#f59e0b] mb-3 flex items-center gap-1.5">
            <Clock size={11} /> Aguardando confirmação ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((c) => (
              <ClaimCard key={c.id} claim={c} onConfirmReceived={confirmReceived} onConfirmSent={confirmSent} />
            ))}
          </div>
        </section>
      )}

      {!loading && received.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-primary mb-3 flex items-center gap-1.5">
            <CheckCircle2 size={11} /> Recebido — aguarda envio ({received.length})
          </h2>
          <div className="space-y-3">
            {received.map((c) => (
              <ClaimCard key={c.id} claim={c} onConfirmReceived={confirmReceived} onConfirmSent={confirmSent} />
            ))}
          </div>
        </section>
      )}

      {!loading && done.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-[#10b981] mb-3 flex items-center gap-1.5">
            <Send size={11} /> Enviado ao seguro ({done.length})
          </h2>
          <div className="space-y-3">
            {done.map((c) => (
              <ClaimCard key={c.id} claim={c} onConfirmReceived={confirmReceived} onConfirmSent={confirmSent} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
