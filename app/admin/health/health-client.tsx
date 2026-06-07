"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Wallet, FileText, Stethoscope, CheckCircle2, AlertTriangle,
  Loader2, ChevronDown, ChevronRight, Send, PauseCircle, ScanLine,
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { PrescriptionAttach } from "./prescription-attach";
import { EligibilityPanel } from "./eligibility-panel";

type Claim = {
  id: string;
  provider_name: string | null;
  patient_name: string | null;
  total_amount: number | null;
  emission_date: string | null;
  payment_status: string | null;
  installments_total: number | null;
  installments_paid: number | null;
  has_payment: boolean;
  has_prescription: boolean;
  has_fiscal_doc: boolean;
  readiness: string;
};

type Summary = {
  total: number;
  total_value: number;
  complete: number;
  complete_value: number;
  needs_prescription: number;
  needs_payment: number;
  needs_both: number;
};

function fmtDate(s: string | null | undefined) {
  return s ? formatDate(s.slice(0, 10)) : "—";
}

const READY_META: Record<string, { label: string; cls: string }> = {
  complete:          { label: "Completo",        cls: "text-[#10b981]" },
  needs_prescription:{ label: "Falta pedido",    cls: "text-[#f59e0b]" },
  needs_payment:     { label: "Falta pagamento", cls: "text-red-400" },
  needs_both:        { label: "Incompleto",      cls: "text-red-400" },
};

function Part({ ok, label, Icon }: { ok: boolean; label: string; Icon: typeof Wallet }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
        ok
          ? "text-[#10b981] border-[#10b981]/25 bg-[#10b981]/5"
          : "text-on-surface-variant/60 border-outline-variant bg-surface-container"
      }`}
    >
      <Icon size={10} />
      {label}
      {ok ? <CheckCircle2 size={9} /> : <span className="text-[9px]">—</span>}
    </span>
  );
}

function StatCard({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="p-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest soft-ambient-shadow">
      <p className={`text-2xl font-semibold tabular-nums ${cls ?? "text-on-surface"}`}>{value}</p>
      <p className="text-[10px] text-on-surface-variant mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-on-surface-variant/60 mt-0.5">{sub}</p>}
    </div>
  );
}

export function HealthClient() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [autoSend, setAutoSend] = useState<boolean | null>(null);
  const [togglingFlag, setTogglingFlag] = useState(false);
  const [showScan, setShowScan] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/health/claims")
      .then((r) => r.json())
      .then((d) => {
        setClaims(d.claims ?? []);
        setSummary(d.summary ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadFlags = useCallback(() => {
    fetch("/api/admin/health/feature-flags")
      .then((r) => r.json())
      .then((d) => {
        const v = d?.flags?.auto_send_secretary;
        setAutoSend(v === true || v === "true");
      })
      .catch(() => setAutoSend(null));
  }, []);

  useEffect(() => { load(); loadFlags(); }, [load, loadFlags]);

  const toggleAutoSend = useCallback(async () => {
    if (autoSend === null) return;
    setTogglingFlag(true);
    const next = !autoSend;
    try {
      await fetch("/api/admin/health/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "auto_send_secretary", value: next }),
      });
      setAutoSend(next);
    } finally {
      setTogglingFlag(false);
    }
  }, [autoSend]);

  const shown = claims.filter((c) => filter === "all" || c.readiness === filter);

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Reembolsos (notas médicas)"
          value={String(summary?.total ?? "—")}
          sub={summary ? formatBRL(summary.total_value) : ""}
        />
        <StatCard
          label="Completos (3 partes)"
          value={String(summary?.complete ?? "—")}
          sub={summary ? formatBRL(summary.complete_value) : ""}
          cls="text-[#10b981]"
        />
        <StatCard
          label="Falta pedido médico"
          value={String(summary?.needs_prescription ?? "—")}
          cls="text-[#f59e0b]"
        />
        <StatCard
          label="Falta comprovante"
          value={String((summary?.needs_payment ?? 0) + (summary?.needs_both ?? 0) || "—")}
          cls="text-red-400"
        />
      </div>

      {/* Legend / explanation */}
      <div className="mb-4 p-3 rounded-xl border border-outline-variant bg-surface-container-lowest flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-on-surface-variant">
          Cada reembolso precisa de 3 partes:{" "}
          <span className="text-on-surface font-medium">pagamento</span> (banco),{" "}
          <span className="text-on-surface font-medium">NF/recibo</span> e{" "}
          <span className="text-on-surface font-medium">pedido médico</span>. Toque numa nota para anexar o pedido (escanear ou upload).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowScan((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition"
          >
            <ScanLine size={11} />
            {showScan ? "Fechar scan" : "Escanear pedido"}
          </button>
          {autoSend !== null && (
            <button
              onClick={toggleAutoSend}
              disabled={togglingFlag}
              title={autoSend ? "Quando uma nota fica completa, o email para Celina sai automaticamente. Clique para pausar." : "Auto-envio pausado. Clique para reativar."}
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition disabled:opacity-50 ${
                autoSend
                  ? "text-[#10b981] border-[#10b981]/30 bg-[#10b981]/5 hover:bg-[#10b981]/10"
                  : "text-on-surface-variant border-outline-variant bg-surface-container hover:bg-surface-container-highest"
              }`}
            >
              {togglingFlag ? <Loader2 size={11} className="animate-spin" /> : autoSend ? <Send size={11} /> : <PauseCircle size={11} />}
              {autoSend ? "Auto-envio: ativo" : "Auto-envio: pausado"}
            </button>
          )}
          <a href="/admin/health/policy" className="text-[11px] text-primary hover:underline whitespace-nowrap font-medium">
            Apólice · Cofre →
          </a>
          <a href="/admin/reembolsos?tag=insurance" className="text-[11px] text-primary hover:underline whitespace-nowrap font-medium">
            Tracker financeiro →
          </a>
        </div>
      </div>

      {/* Standalone prescription scan panel (no specific NF pre-selected) */}
      {showScan && (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/3 overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <p className="text-[11px] font-semibold text-on-surface">Escanear pedido avulso</p>
            <p className="text-[10px] text-on-surface-variant mt-0.5">
              Foto ou upload → escolha a nota a vincular
            </p>
          </div>
          <PrescriptionAttach
            onChanged={() => { load(); setShowScan(false); }}
          />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { k: "all", l: "Todos" },
          { k: "complete", l: "Completos" },
          { k: "needs_prescription", l: "Falta pedido" },
          { k: "needs_payment", l: "Falta comprovante" },
          { k: "needs_both", l: "Incompletos" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === t.k
                ? "bg-primary/10 text-primary border-primary/30"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* Claims list */}
      <div className="rounded-xl border border-outline-variant overflow-hidden bg-surface-container-lowest">
        {loading && (
          <div className="flex items-center justify-center py-14">
            <Loader2 size={20} className="animate-spin text-on-surface-variant" />
          </div>
        )}
        {!loading && shown.length === 0 && (
          <div className="text-center py-14 text-sm text-on-surface-variant">Nenhuma nota nesta categoria</div>
        )}
        {!loading && shown.length > 0 && (
          <div className="divide-y divide-outline-variant">
            {shown.map((c) => {
              const isOpen = expanded === c.id;
              const rm = READY_META[c.readiness] ?? READY_META.needs_both;
              return (
                <div key={c.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    className="w-full px-4 py-3 text-left hover:bg-surface-container transition flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-xs text-on-surface truncate font-medium">{c.provider_name ?? "—"}</p>
                        <span className={`text-[10px] font-semibold shrink-0 ${rm.cls}`}>{rm.label}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-on-surface-variant tabular-nums">{fmtDate(c.emission_date)}</span>
                        {c.patient_name && c.patient_name !== "Mickael" && (
                          <span className="text-[10px] text-on-surface-variant">· {c.patient_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Part ok={c.has_payment} label="Pgto" Icon={Wallet} />
                        <Part ok={c.has_fiscal_doc} label="NF" Icon={FileText} />
                        <Part ok={c.has_prescription} label="Pedido" Icon={Stethoscope} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs tabular-nums font-semibold text-on-surface">
                        {formatBRL(Number(c.total_amount ?? 0))}
                      </p>
                      {isOpen ? <ChevronDown size={14} className="text-on-surface-variant inline mt-1" /> : <ChevronRight size={14} className="text-on-surface-variant inline mt-1" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 bg-surface-container/40 space-y-3">
                      {/* payment line */}
                      <div className="flex items-center gap-2 text-[11px] pt-3">
                        <Wallet size={12} className={c.has_payment ? "text-[#10b981]" : "text-red-400"} />
                        <span className="text-on-surface-variant">
                          {c.has_payment
                            ? `Pagamento: ${c.payment_status === "paying" ? `pagando ${c.installments_paid}/${c.installments_total}` : "pago"}`
                            : "Pagamento: comprovante não localizado"}
                        </span>
                      </div>
                      {/* prescription */}
                      {c.has_prescription ? (
                        <div className="flex items-center gap-2 text-[11px]">
                          <Stethoscope size={12} className="text-[#10b981]" />
                          <span className="text-[#10b981] font-medium">Pedido médico vinculado</span>
                        </div>
                      ) : (
                        <PrescriptionAttach nfId={c.id} onChanged={load} compact />
                      )}
                      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
                        <EligibilityPanel nfId={c.id} compact />
                      </div>
                      <a
                        href={`/admin/nota-fiscais?id=${c.id}`}
                        className="inline-block text-[11px] text-primary hover:underline"
                      >
                        Ver na lista de notas →
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* needs-prescription nudge */}
      {summary && summary.needs_prescription > 0 && filter === "all" && (
        <div className="mt-4 p-3 rounded-xl border border-[#f59e0b]/25 bg-[#f59e0b]/5 flex items-start gap-2">
          <AlertTriangle size={13} className="text-[#f59e0b] shrink-0 mt-0.5" />
          <p className="text-[11px] text-on-surface">
            <span className="font-semibold">{summary.needs_prescription} nota(s)</span> já pagas só esperam o pedido médico para o reembolso. Peça ao médico e escaneie aqui.
          </p>
        </div>
      )}
    </>
  );
}
