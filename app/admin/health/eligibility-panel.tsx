"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, AlertTriangle, Loader2, CheckCircle2, XCircle, MinusCircle,
  AlertCircle, Sparkles, Lock, RotateCw, Eye, ExternalLink, PencilLine, X,
  Wrench, Send, ChevronDown, ChevronRight,
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { SourceQuote } from "./source-quote";
import { safeJson } from "@/lib/http";

// ============================================================================
// The "AI explains" panel — the user's #1 ask.
//   "AI explains why each medical bill enters the policy or not, under what
//    category, and the expected reimbursement amount."
//
// Mounted in two places (so the user has the explanation wherever they look):
//   - app/admin/health/health-client.tsx — inside a claim row's expand block
//   - app/admin/nota-fiscais/nota-fiscais-client.tsx — inside the detail modal
// ============================================================================

type Eligibility =
  | "eligible" | "partial" | "not_eligible" | "over_limit"
  | "needs_review" | "needs_prescription" | "needs_preauth" | "out_of_filing_window";

type GateName =
  | "filing_deadline" | "patient_covered" | "zona" | "exclusion"
  | "deductible" | "waiting_period" | "prescription" | "preauth" | "payment_proof";

type GateStatus = "pass" | "fail" | "n/a" | "warn";

type Gate = {
  name: GateName;
  status: GateStatus;
  detail: string;
  source_quote?: string | null;
  term_id?: string | null;
};

type Detail = {
  category_match: {
    ai_category: string;
    ai_confidence: "high" | "medium" | "low";
    ai_reasoning: string;
    candidate_rule_ids: string[];
    patient_dependent_id: string | null;
    exclusion_term_id: string | null;
  };
  applied_rule: {
    id: string;
    section: string | null;
    benefit_name: string | null;
    coverage_basis: string | null;
    source_quote: string | null;
  } | null;
  calculation: {
    gross_amount: number;
    coverage_pct: number | null;
    cap_per_event: number | null;
    multiple_value: number | null;
    multiple_count: number | null;
    computed_before_cap: number;
    computed_after_cap: number;
    annual_limit_amount: number | null;
    annual_used_before: number;
    annual_remaining: number | null;
    final_eligible: number;
    currency: string | null;
  };
  gates: Gate[];
  deadline_date: string | null;
  ai_model_used: string | null;
  determined_at: string;
};

type Claim = {
  id: string;
  nota_fiscal_id: string;
  eligibility: Eligibility | null;
  eligible_amount: number | null;
  applied_rule_id: string | null;
  reasoning: string | null;
  confidence: "high" | "medium" | "low" | null;
  determined_by: "ai" | "manual" | null;
  annual_used_before: number | null;
  deadline_date: string | null;
  eligibility_detail: Detail | null;
  eligibility_determined_at: string | null;
  ai_model_used: string | null;
  manually_confirmed_at: string | null;
};

const ELIG_META: Record<Eligibility, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  eligible:            { label: "Elegível",          cls: "text-[#10b981] bg-[#10b981]/10 border-[#10b981]/30", Icon: CheckCircle2 },
  partial:             { label: "Parcial",           cls: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30", Icon: AlertCircle },
  not_eligible:        { label: "Não elegível",      cls: "text-red-400 bg-red-400/10 border-red-400/30",       Icon: XCircle },
  over_limit:          { label: "Teto atingido",     cls: "text-red-400 bg-red-400/10 border-red-400/30",       Icon: AlertTriangle },
  needs_review:        { label: "Precisa revisão",   cls: "text-on-surface-variant bg-surface-container border-outline-variant", Icon: AlertCircle },
  needs_prescription:  { label: "Falta pedido",      cls: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30", Icon: AlertTriangle },
  needs_preauth:       { label: "Falta pré-autoriz.", cls: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30", Icon: AlertTriangle },
  out_of_filing_window:{ label: "Fora do prazo",     cls: "text-red-400 bg-red-400/10 border-red-400/30",       Icon: XCircle },
};

const GATE_LABELS: Record<GateName, string> = {
  filing_deadline: "Prazo de envio (2 anos)",
  patient_covered: "Paciente coberto",
  zona: "Cobertura geográfica",
  exclusion: "Não cai em exclusão",
  deductible: "Franquia",
  waiting_period: "Carência",
  prescription: "Pedido médico",
  preauth: "Pré-autorização",
  payment_proof: "Comprovante de pagamento",
};

// What to DO about each failed gate — concrete next action, honest when there
// is nothing to be done. Rendered in the "O que fazer" box.
const GATE_FIX: Record<GateName, { action: string; fixable: boolean }> = {
  filing_deadline: { action: "O prazo de 2 anos da APRIL estourou — este claim não pode mais ser enviado.", fixable: false },
  patient_covered: { action: "O paciente da nota não consta na apólice. Se for um dos beneficiários, corrija o nome do paciente na NF; se não for, não há cobertura.", fixable: true },
  zona: { action: "Atendimento fora da Zona 2 de cobertura. Verifique o país do prestador — fora da zona não há reembolso.", fixable: false },
  exclusion: { action: "Este tratamento está na lista de exclusões da apólice — sem cobertura. Veja a citação da regra acima.", fixable: false },
  deductible: { action: "Verifique a franquia aplicável na apólice.", fixable: true },
  waiting_period: { action: "Ainda dentro da carência para este tipo de tratamento. Aguarde o fim da carência — notas emitidas depois dessa data são elegíveis.", fixable: false },
  prescription: { action: "Anexe o pedido/receita médica (datado ANTES da emissão da nota). Peça ao médico se não tiver — sem ele a APRIL recusa.", fixable: true },
  preauth: { action: "Este tratamento exige pré-autorização da APRIL. Para tratamentos futuros, solicite ANTES pelo app Easy Claim ou care@april-international.com. Para esta nota, envie mesmo assim com justificativa médica — a APRIL pode aceitar.", fixable: true },
  payment_proof: { action: "Anexe o comprovante de pagamento (a APRIL só reembolsa despesa já paga).", fixable: true },
};

type Filing = {
  how_to_submit: { title: string | null; text: string }[];
  required_documents: string[];
};

function gateIcon(status: GateStatus) {
  if (status === "pass") return <CheckCircle2 size={12} className="text-[#10b981] shrink-0" />;
  if (status === "fail") return <XCircle size={12} className="text-red-400 shrink-0" />;
  if (status === "warn") return <AlertTriangle size={12} className="text-[#f59e0b] shrink-0" />;
  return <MinusCircle size={12} className="text-on-surface-variant/60 shrink-0" />;
}

function ConfLabel({ c }: { c: "high" | "medium" | "low" }) {
  const map = {
    high:   { label: "alta",  cls: "text-[#10b981]" },
    medium: { label: "média", cls: "text-[#f59e0b]" },
    low:    { label: "baixa", cls: "text-red-400" },
  } as const;
  return <span className={`text-[10px] font-medium ${map[c].cls}`}>conf. {map[c].label}</span>;
}

function fmt(s: string | null | undefined) {
  return s ? formatDate(s.slice(0, 10)) : "—";
}

function formatCurrency(amount: number, currency: string | null): string {
  // BRL → use existing helper; EUR/USD/other → simple format
  if (!currency || currency === "BRL") return formatBRL(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currency} ${abs.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EligibilityPanel({
  nfId,
  compact,
}: {
  nfId: string;
  compact?: boolean;
}) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [filing, setFiling] = useState<Filing | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/health/claims/${nfId}/eligibility`)
      .then((r) => r.json())
      .then((d) => { setClaim(d.claim ?? null); setFiling(d.filing ?? null); })
      .catch(() => setClaim(null))
      .finally(() => setLoading(false));
  }, [nfId]);

  useEffect(() => { load(); }, [load]);

  const recompute = useCallback(async (force = false) => {
    setRunning(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/health/claims/${nfId}/eligibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (r.status === 409) {
        const j = await r.json();
        setErr(j.message ?? "Confirmação manual ativa.");
        return;
      }
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [nfId, load]);

  if (loading) {
    return (
      <div className={compact ? "px-3 py-2" : "px-5 py-4"}>
        <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
          <Loader2 size={12} className="animate-spin" />
          Verificando elegibilidade…
        </div>
      </div>
    );
  }

  // First-time: no claim row yet → show "Run" CTA
  if (!claim || !claim.eligibility) {
    return (
      <div className={compact ? "px-3 py-3" : "px-5 py-4"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
            <Sparkles size={12} className="text-primary" />
            Análise de elegibilidade não executada ainda.
          </p>
          <button
            onClick={() => recompute(false)}
            disabled={running}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-primary/40 text-primary hover:bg-primary/5 transition disabled:opacity-50"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Analisar com IA
          </button>
        </div>
        {err && <p className="text-[10px] text-red-400 mt-2">{err}</p>}
      </div>
    );
  }

  const eligibility = claim.eligibility;
  const meta = ELIG_META[eligibility];
  const detail = claim.eligibility_detail;
  const isManual = !!claim.manually_confirmed_at;
  const currency = detail?.calculation.currency ?? null;

  return (
    <div className={compact ? "px-3 py-3 space-y-3" : "px-5 py-4 space-y-3"}>
      {/* Header — status + confidence + manual lock + actions */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.cls}`}>
            <meta.Icon size={11} />
            {meta.label}
          </span>
          {claim.eligible_amount != null && claim.eligible_amount > 0 && (
            <span className="text-xs font-semibold tabular-nums text-on-surface">
              {/* Amount is the NF total reimbursable — same currency as the NF (BRL) */}
              {formatBRL(Number(claim.eligible_amount))}
            </span>
          )}
          {detail && <ConfLabel c={detail.category_match.ai_confidence} />}
          {isManual ? (
            <span className="inline-flex items-center gap-1 text-[9px] text-on-surface-variant border border-outline-variant px-1.5 py-0.5 rounded-full">
              <Lock size={9} /> Confirmado manualmente
            </span>
          ) : claim.determined_by === "ai" ? (
            <span className="inline-flex items-center gap-1 text-[9px] text-on-surface-variant/70" title="Determinação automática — confirme manualmente para travar">
              <Sparkles size={9} /> IA · não confirmado
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => recompute(isManual)}
            disabled={running}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-outline-variant text-on-surface-variant hover:bg-surface-container transition disabled:opacity-50"
            title={isManual ? "Forçar recomputação (sobrescreve a confirmação manual)" : "Rodar a análise novamente"}
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
            Recomputar
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-outline-variant text-on-surface-variant hover:bg-surface-container transition"
          >
            <PencilLine size={10} />
            Confirmar
          </button>
        </div>
      </div>

      {/* Reasoning (short PT-BR prose) */}
      {claim.reasoning && (
        <p className="text-[12px] text-on-surface leading-snug">{claim.reasoning}</p>
      )}

      {/* Category */}
      {detail && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-on-surface-variant">Categoria:</span>
          <span className="text-on-surface font-medium">{detail.category_match.ai_category}</span>
          {detail.category_match.ai_reasoning && (
            <span className="text-on-surface-variant/70 truncate" title={detail.category_match.ai_reasoning}>
              · {detail.category_match.ai_reasoning}
            </span>
          )}
        </div>
      )}

      {/* Applied rule + source quote */}
      {detail?.applied_rule && (
        <div className="p-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider">{detail.applied_rule.section ?? "—"}</p>
              <p className="text-[12px] text-on-surface font-medium truncate">{detail.applied_rule.benefit_name ?? "—"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {detail.applied_rule.coverage_basis && (
                <span className="text-[10px] tabular-nums text-on-surface">{detail.applied_rule.coverage_basis}</span>
              )}
              <a
                href={`/admin/health/policy#rule-${detail.applied_rule.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                title="Ver na apólice"
              >
                <ExternalLink size={9} />
                regra
              </a>
            </div>
          </div>
          <SourceQuote text={detail.applied_rule.source_quote} />
        </div>
      )}

      {/* Calculation breakdown */}
      {detail && detail.calculation.gross_amount > 0 && (
        <div className="text-[11px] grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          <span className="text-on-surface-variant">Valor da nota</span>
          <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.gross_amount, "BRL")}</span>
          {detail.calculation.coverage_pct != null && (
            <>
              <span className="text-on-surface-variant">Cobertura</span>
              <span className="tabular-nums text-on-surface text-right">{Math.round(detail.calculation.coverage_pct * 100)}%</span>
            </>
          )}
          {detail.calculation.multiple_count != null && detail.calculation.multiple_value != null && (
            <>
              <span className="text-on-surface-variant">Múltiplo</span>
              <span className="tabular-nums text-on-surface text-right">
                {detail.calculation.multiple_count} × {formatCurrency(detail.calculation.multiple_value, currency)}
              </span>
            </>
          )}
          <span className="text-on-surface-variant">Antes do teto</span>
          <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.computed_before_cap, currency)}</span>
          {detail.calculation.cap_per_event != null && (
            <>
              <span className="text-on-surface-variant">Teto por evento</span>
              <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.cap_per_event, currency)}</span>
            </>
          )}
          {detail.calculation.annual_limit_amount != null && (
            <>
              <span className="text-on-surface-variant">Limite anual</span>
              <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.annual_limit_amount, currency)}</span>
              <span className="text-on-surface-variant">Já usado este ano</span>
              <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.annual_used_before, currency)}</span>
              <span className="text-on-surface-variant">Disponível</span>
              <span className="tabular-nums text-on-surface text-right">{formatCurrency(detail.calculation.annual_remaining ?? 0, currency)}</span>
            </>
          )}
          <div className="col-span-2 border-t border-outline-variant my-1" />
          <span className="text-on-surface font-semibold">Reembolsável</span>
          <span className="tabular-nums font-semibold text-[#10b981] text-right">{formatCurrency(detail.calculation.final_eligible, currency)}</span>
        </div>
      )}

      {/* Gates */}
      {detail && detail.gates.length > 0 && (
        <div className="space-y-1">
          {detail.gates.map((g, i) => (
            <GateRow key={`${g.name}-${i}`} gate={g} />
          ))}
        </div>
      )}

      {/* O que fazer — concrete next actions for every failed/warn gate */}
      {detail && (() => {
        const blockers = detail.gates.filter((g) => g.status === "fail" || g.status === "warn");
        if (blockers.length === 0) return null;
        return (
          <div className="p-2.5 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#f59e0b] flex items-center gap-1.5 mb-1.5">
              <Wrench size={11} /> O que fazer
            </p>
            <ul className="space-y-1">
              {blockers.map((g, i) => {
                const fix = GATE_FIX[g.name];
                return (
                  <li key={`fix-${g.name}-${i}`} className="text-[11px] text-on-surface flex items-start gap-1.5">
                    {fix.fixable
                      ? <CheckCircle2 size={11} className="text-[#f59e0b] mt-0.5 shrink-0" />
                      : <XCircle size={11} className="text-red-400 mt-0.5 shrink-0" />}
                    <span>{fix.action}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {/* Como enviar o claim — filing channels + document checklist */}
      {filing && eligibility !== "not_eligible" && eligibility !== "out_of_filing_window" && (
        <FilingGuide filing={filing} needsPreauth={detail?.gates.some((g) => g.name === "preauth" && g.status !== "n/a") ?? false} />
      )}

      {/* Deadline */}
      {detail?.deadline_date && (
        <p className="text-[10px] text-on-surface-variant/70">
          Prazo final p/ envio: {fmt(detail.deadline_date)} · análise rodada em {detail.determined_at ? fmt(detail.determined_at) : "—"}{detail.ai_model_used ? ` · ${detail.ai_model_used}` : ""}
        </p>
      )}

      {err && (
        <p className="text-[10px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={10} /> {err}
        </p>
      )}

      {/* Manual confirm modal */}
      {showConfirm && claim && (
        <ConfirmModal
          nfId={nfId}
          current={claim}
          onClose={() => setShowConfirm(false)}
          onDone={() => { setShowConfirm(false); load(); }}
        />
      )}
    </div>
  );
}

function FilingGuide({ filing, needsPreauth }: { filing: Filing; needsPreauth: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-2 flex items-center gap-1.5 text-left hover:bg-surface-container transition"
      >
        {open ? <ChevronDown size={11} className="text-on-surface-variant shrink-0" /> : <ChevronRight size={11} className="text-on-surface-variant shrink-0" />}
        <Send size={11} className="text-[#0ea5e9] shrink-0" />
        <span className="text-[11px] font-medium text-on-surface">Como enviar o claim na APRIL</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {filing.how_to_submit.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Canais</p>
              {filing.how_to_submit.map((h, i) => (
                <p key={i} className="text-[11px] text-on-surface leading-snug">
                  {h.title && h.title !== "How to submit" ? <span className="font-medium">{h.title}: </span> : null}
                  {h.text}
                </p>
              ))}
            </div>
          )}
          {filing.required_documents.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Checklist de documentos</p>
              <ul className="space-y-0.5">
                {filing.required_documents.map((d, i) => (
                  <li key={i} className="text-[11px] text-on-surface flex items-start gap-1.5">
                    <CheckCircle2 size={11} className="text-on-surface-variant/60 mt-0.5 shrink-0" />
                    {d}
                  </li>
                ))}
                {needsPreauth && (
                  <li className="text-[11px] text-on-surface flex items-start gap-1.5">
                    <AlertTriangle size={11} className="text-[#f59e0b] mt-0.5 shrink-0" />
                    Este benefício exige o formulário de pré-autorização aprovado pelo departamento médico da APRIL.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GateRow({ gate }: { gate: Gate }) {
  const [open, setOpen] = useState(false);
  const hasSource = !!gate.source_quote;
  return (
    <div className="text-[11px]">
      <button
        onClick={() => hasSource && setOpen((v) => !v)}
        disabled={!hasSource}
        className={`w-full flex items-start gap-1.5 text-left ${hasSource ? "hover:bg-surface-container rounded px-1 py-0.5 -mx-1" : ""}`}
      >
        {gateIcon(gate.status)}
        <span className="text-on-surface-variant">
          <span className="text-on-surface">{GATE_LABELS[gate.name]}</span>
          {gate.detail ? <> · {gate.detail}</> : null}
        </span>
        {hasSource && <Eye size={10} className="ml-auto text-on-surface-variant/60 mt-0.5 shrink-0" />}
      </button>
      {open && hasSource && (
        <div className="ml-5">
          <SourceQuote text={gate.source_quote ?? null} />
        </div>
      )}
    </div>
  );
}

function ConfirmModal({
  nfId, current, onClose, onDone,
}: {
  nfId: string;
  current: Claim;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility>(current.eligibility ?? "eligible");
  const [amount, setAmount] = useState<string>(String(current.eligible_amount ?? 0));
  const [reasoning, setReasoning] = useState<string>(current.reasoning ?? "");

  const allowedStatuses = useMemo<Eligibility[]>(() => [
    "eligible", "partial", "not_eligible", "over_limit",
    "needs_review", "needs_prescription", "needs_preauth", "out_of_filing_window",
  ], []);

  async function submit() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/health/claims/${nfId}/eligibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eligibility,
          eligible_amount: Number(amount) || 0,
          reasoning,
          manually_confirmed: true,
        }),
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 pb-4 bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-outline-variant flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
          <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
            <ShieldCheck size={14} className="text-primary" />
            Confirmar elegibilidade manualmente
          </p>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface"><X size={16} /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">Status</label>
            <select
              value={eligibility}
              onChange={(e) => setEligibility(e.target.value as Eligibility)}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:outline-none focus:border-primary"
            >
              {allowedStatuses.map((s) => (
                <option key={s} value={s}>{ELIG_META[s].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">Valor reembolsável</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:outline-none focus:border-primary tabular-nums"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">Observação</label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={3}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:outline-none focus:border-primary"
            />
          </div>
          <p className="text-[10px] text-on-surface-variant/70 flex items-start gap-1">
            <Lock size={10} className="mt-0.5 shrink-0" />
            Ao confirmar, este claim fica travado contra recálculos automáticos da IA.
          </p>
          {err && <p className="text-[10px] text-red-400">{err}</p>}
        </div>
        <div className="px-4 py-3 border-t border-outline-variant flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-on-primary hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
