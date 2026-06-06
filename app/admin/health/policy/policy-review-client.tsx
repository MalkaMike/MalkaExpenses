"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, FileText, Users, BookOpen, AlertTriangle, Quote,
  CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { formatDate } from "@/lib/format";

type Member = { id: string; name: string; relationship: string | null; birth_date: string | null };
type Rule = {
  id: string;
  section: string | null;
  benefit_name: string | null;
  category: string | null;
  coverage_basis: string | null;
  plan_tier: string | null;
  notes: string | null;
  requires_preauth: boolean;
  requires_prescription: boolean;
  source_quote: string | null;
  human_confirmed: boolean;
};
type Term = {
  id: string;
  term_type: string;
  title: string | null;
  text: string;
  source_quote: string | null;
  source_document: string | null;
  human_confirmed: boolean;
};
type Doc = {
  id: string;
  doc_type: string | null;
  file_name: string;
  byte_size: number | null;
  created_at: string | null;
};
type Policy = {
  id: string;
  insurer_name: string;
  plan_name: string | null;
  plan_tier: string | null;
  policy_number: string | null;
  holder_name: string | null;
  currency: string | null;
  cover_zone: string | null;
  overall_annual_limit: string | null;
  deductible_text: string | null;
  reimbursement_iban_last4: string | null;
  reimbursement_bank: string | null;
  intermediary_name: string | null;
  intermediary_email: string | null;
  intermediary_phone: string | null;
  claim_filing_limit: string | null;
  extraction_confidence: string | null;
  human_confirmed: boolean;
  policy_dependents: Member[];
  policy_coverage_rules: Rule[];
  policy_terms: Term[];
  policy_documents: Doc[];
};

type Summary = {
  rules_total: number;
  rules_confirmed: number;
  terms_total: number;
  terms_confirmed: number;
};

const TERM_META: Record<string, { label: string; cls: string; Icon: typeof BookOpen }> = {
  exclusion:         { label: "Exclusões",          cls: "text-red-400",        Icon: AlertTriangle },
  claim_rule:        { label: "Regras de claim",    cls: "text-[#0ea5e9]",      Icon: BookOpen },
  waiting_period:    { label: "Carências",          cls: "text-[#f59e0b]",      Icon: BookOpen },
  required_document: { label: "Documentos exigidos", cls: "text-[#8b5cf6]",      Icon: FileText },
  definition:        { label: "Definições / zonas", cls: "text-on-surface-variant", Icon: BookOpen },
  other:             { label: "Outros",             cls: "text-on-surface-variant", Icon: BookOpen },
};

function fmt(s: string | null | undefined) {
  return s ? formatDate(s.slice(0, 10)) : "—";
}

function ConfirmTick({
  confirmed,
  busy,
  onClick,
}: {
  confirmed: boolean;
  busy: boolean;
  onClick: (next: boolean) => void;
}) {
  return (
    <button
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); onClick(!confirmed); }}
      className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border transition ${
        confirmed
          ? "text-[#10b981] border-[#10b981]/30 bg-[#10b981]/10"
          : "text-on-surface-variant border-outline-variant hover:bg-surface-container"
      } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : confirmed ? <CheckCircle2 size={11} /> : <Circle size={11} />}
      {confirmed ? "Confirmado" : "Confirmar"}
    </button>
  );
}

function SourceQuote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-[10px] text-on-surface-variant/80 italic mt-1.5 flex items-start gap-1">
      <Quote size={9} className="shrink-0 mt-0.5" />
      <span className="line-clamp-3">&ldquo;{text}&rdquo;</span>
    </p>
  );
}

function RuleRow({
  rule, onConfirm, busy,
}: {
  rule: Rule;
  onConfirm: (id: string, next: boolean) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-outline-variant last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left hover:bg-surface-container transition flex items-start gap-2"
      >
        <span className="text-on-surface-variant pt-0.5">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-on-surface font-medium truncate flex-1 min-w-0">{rule.benefit_name ?? "—"}</p>
            <span className="text-[10px] tabular-nums text-on-surface-variant shrink-0">{rule.coverage_basis ?? "—"}</span>
          </div>
          {(rule.notes || rule.requires_preauth || rule.requires_prescription) && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {rule.notes && <span className="text-[10px] text-on-surface-variant truncate">{rule.notes}</span>}
              {rule.requires_preauth && <span className="text-[9px] text-[#f59e0b] font-medium">pré-autorização</span>}
              {rule.requires_prescription && <span className="text-[9px] text-[#8b5cf6] font-medium">pedido médico</span>}
            </div>
          )}
        </div>
        <ConfirmTick confirmed={rule.human_confirmed} busy={busy} onClick={(n) => onConfirm(rule.id, n)} />
      </button>
      {open && <div className="px-7 pb-3"><SourceQuote text={rule.source_quote} /></div>}
    </div>
  );
}

function TermRow({
  term, onConfirm, busy,
}: {
  term: Term;
  onConfirm: (id: string, next: boolean) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-outline-variant last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left hover:bg-surface-container transition flex items-start gap-2"
      >
        <span className="text-on-surface-variant pt-0.5">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <div className="flex-1 min-w-0">
          {term.title && <p className="text-xs text-on-surface font-medium truncate">{term.title}</p>}
          <p className={`text-[11px] text-on-surface-variant ${term.title ? "mt-0.5" : ""} line-clamp-2`}>{term.text}</p>
        </div>
        <ConfirmTick confirmed={term.human_confirmed} busy={busy} onClick={(n) => onConfirm(term.id, n)} />
      </button>
      {open && <div className="px-7 pb-3 space-y-1">
        {term.source_document && <p className="text-[10px] text-on-surface-variant/60">Fonte: {term.source_document}</p>}
        <SourceQuote text={term.source_quote} />
      </div>}
    </div>
  );
}

function Gauge({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="p-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest soft-ambient-shadow">
      <p className="text-2xl font-semibold tabular-nums text-on-surface">{done}<span className="text-base text-on-surface-variant"> / {total}</span></p>
      <p className="text-[10px] text-on-surface-variant mt-0.5">{label}</p>
      <div className="h-1.5 rounded-full bg-surface-container mt-2 overflow-hidden">
        <div className="h-full bg-[#10b981] transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PolicyReviewClient() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/health/policy")
      .then((r) => r.json())
      .then((d) => { setPolicy(d.policy); setSummary(d.summary); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const confirm = useCallback(async (kind: "rule" | "term" | "policy", id: string, next: boolean) => {
    setSavingId(id);
    try {
      await fetch("/api/admin/health/policy/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, human_confirmed: next }),
      });
      setPolicy((prev) => {
        if (!prev) return prev;
        if (kind === "policy") return { ...prev, human_confirmed: next };
        if (kind === "rule") {
          const rules = prev.policy_coverage_rules.map((r) => r.id === id ? { ...r, human_confirmed: next } : r);
          return { ...prev, policy_coverage_rules: rules };
        }
        const terms = prev.policy_terms.map((t) => t.id === id ? { ...t, human_confirmed: next } : t);
        return { ...prev, policy_terms: terms };
      });
      setSummary((s) => {
        if (!s) return s;
        const delta = next ? 1 : -1;
        if (kind === "rule") return { ...s, rules_confirmed: Math.max(0, s.rules_confirmed + delta) };
        if (kind === "term") return { ...s, terms_confirmed: Math.max(0, s.terms_confirmed + delta) };
        return s;
      });
    } finally {
      setSavingId(null);
    }
  }, []);

  const rulesBySection = useMemo(() => {
    const m = new Map<string, Rule[]>();
    (policy?.policy_coverage_rules ?? []).forEach((r) => {
      const k = r.section ?? "Outros";
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    });
    return m;
  }, [policy]);

  const termsByType = useMemo(() => {
    const m = new Map<string, Term[]>();
    (policy?.policy_terms ?? []).forEach((t) => {
      const list = m.get(t.term_type) ?? [];
      list.push(t);
      m.set(t.term_type, list);
    });
    return m;
  }, [policy]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-on-surface-variant" /></div>;
  }
  if (!policy) {
    return <p className="text-sm text-on-surface-variant text-center py-12">Nenhuma apólice ativa no cofre.</p>;
  }

  const fullyConfirmed =
    policy.human_confirmed
    && (summary?.rules_total ?? 0) > 0
    && summary?.rules_confirmed === summary?.rules_total
    && summary?.terms_confirmed === summary?.terms_total;

  return (
    <>
      {/* Identity */}
      <div className="mb-5 p-4 rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ShieldCheck size={16} className="text-primary shrink-0" />
              <p className="font-semibold text-sm text-on-surface">{policy.insurer_name} · {policy.plan_name ?? "—"}</p>
              {policy.plan_tier && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">{policy.plan_tier}</span>}
              {policy.cover_zone && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">Zona {policy.cover_zone}</span>}
              {policy.currency && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{policy.currency}</span>}
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1">{policy.policy_number} · titular {policy.holder_name}</p>
          </div>
          <ConfirmTick confirmed={policy.human_confirmed} busy={savingId === policy.id} onClick={(n) => confirm("policy", policy.id, n)} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
          <div><p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Limite anual</p><p className="text-on-surface">{policy.overall_annual_limit ?? "—"}</p></div>
          <div><p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Franquia</p><p className="text-on-surface">{policy.deductible_text ?? "—"}</p></div>
          <div><p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Prazo claim</p><p className="text-on-surface line-clamp-2">{policy.claim_filing_limit ?? "—"}</p></div>
          <div><p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">IBAN reembolso</p><p className="text-on-surface">{policy.reimbursement_bank ?? "—"} · …{policy.reimbursement_iban_last4 ?? "—"}</p></div>
        </div>

        {(policy.intermediary_name || policy.intermediary_email) && (
          <div className="mt-3 pt-3 border-t border-outline-variant text-[11px] text-on-surface-variant">
            Intermediário: <span className="text-on-surface">{policy.intermediary_name}</span>
            {policy.intermediary_email && <> · <a href={`mailto:${policy.intermediary_email}`} className="text-primary hover:underline">{policy.intermediary_email}</a></>}
            {policy.intermediary_phone && <> · {policy.intermediary_phone}</>}
          </div>
        )}
      </div>

      {/* Verification gauges */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <Gauge done={summary.rules_confirmed} total={summary.rules_total} label="Regras de cobertura confirmadas" />
          <Gauge done={summary.terms_confirmed} total={summary.terms_total} label="Termos confirmados" />
        </div>
      )}

      {fullyConfirmed && (
        <div className="mb-5 p-3 rounded-xl border border-[#10b981]/30 bg-[#10b981]/5 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#10b981] shrink-0" />
          <p className="text-[11px] text-on-surface">Apólice totalmente verificada. As regras estão prontas para serem usadas pelo motor de elegibilidade.</p>
        </div>
      )}

      {/* Members */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Users size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Beneficiários ({policy.policy_dependents.length})</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
          <div className="divide-y divide-outline-variant">
            {policy.policy_dependents.map((m) => (
              <div key={m.id} className="px-3 py-2 flex items-center justify-between text-xs">
                <span className="text-on-surface">{m.name}</span>
                <span className="text-on-surface-variant tabular-nums">{fmt(m.birth_date)} · {m.relationship ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Coverage rules grouped by section */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Cobertura ({policy.policy_coverage_rules.length})</p>
        </div>
        <div className="space-y-3">
          {Array.from(rulesBySection.entries()).map(([section, rules]) => (
            <div key={section} className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
              <div className="px-3 py-2 bg-surface-container border-b border-outline-variant flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{section}</p>
                <p className="text-[10px] text-on-surface-variant tabular-nums">
                  {rules.filter((r) => r.human_confirmed).length} / {rules.length}
                </p>
              </div>
              {rules.map((r) => (
                <RuleRow key={r.id} rule={r} onConfirm={(id, next) => confirm("rule", id, next)} busy={savingId === r.id} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Terms grouped by type */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Termos ({policy.policy_terms.length})</p>
        </div>
        <div className="space-y-3">
          {Array.from(termsByType.entries()).map(([type, terms]) => {
            const meta = TERM_META[type] ?? TERM_META.other;
            return (
              <div key={type} className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
                <div className="px-3 py-2 bg-surface-container border-b border-outline-variant flex items-center justify-between">
                  <p className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${meta.cls}`}>
                    <meta.Icon size={11} />
                    {meta.label}
                  </p>
                  <p className="text-[10px] text-on-surface-variant tabular-nums">
                    {terms.filter((t) => t.human_confirmed).length} / {terms.length}
                  </p>
                </div>
                {terms.map((t) => (
                  <TermRow key={t.id} term={t} onConfirm={(id, next) => confirm("term", id, next)} busy={savingId === t.id} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Documents */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Documentos no cofre ({policy.policy_documents.length})</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
          <div className="divide-y divide-outline-variant">
            {policy.policy_documents.map((d) => (
              <div key={d.id} className="px-3 py-2 flex items-center justify-between text-xs">
                <div className="min-w-0">
                  <p className="text-on-surface truncate">{d.file_name}</p>
                  <p className="text-[10px] text-on-surface-variant">{d.doc_type ?? "—"}</p>
                </div>
                <p className="text-[10px] text-on-surface-variant shrink-0 ml-3 tabular-nums">{Math.round((d.byte_size ?? 0) / 1024)} KB</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-on-surface-variant/70 mt-2">Os PDFs estão em <code>private/insurance-vault/</code> (gitignored). Em produção, vão pro Supabase Storage com URLs assinadas.</p>
      </div>
    </>
  );
}
