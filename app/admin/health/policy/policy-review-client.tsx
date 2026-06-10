"use client";

// ============================================================================
// The policy "safe" — READ-ONLY reference view.
//
// No confirmation workflow: the AI-extracted rules are used directly by the
// eligibility engine. This screen exists so anyone can SEE what the policy
// covers (datatable with search), the waiting periods, exclusions, required
// claim documents and how to file — each row still carries its verbatim
// source quote (click a row to reveal it).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, FileText, Users, BookOpen, AlertTriangle, Loader2,
  Search, ChevronDown, ChevronRight, Clock, Send, ClipboardList,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { SourceQuote } from "@/app/admin/health/source-quote";

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
};
type Term = {
  id: string;
  term_type: string;
  title: string | null;
  text: string;
  source_quote: string | null;
  source_document: string | null;
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
  policy_dependents: Member[];
  policy_coverage_rules: Rule[];
  policy_terms: Term[];
  policy_documents: Doc[];
};

function fmt(s: string | null | undefined) {
  return s ? formatDate(s.slice(0, 10)) : "—";
}

function fmtBytes(b: number | null) {
  if (!b) return "—";
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(b / 1000)} KB`;
}

// Fixed section display order for the coverage table
const SECTION_ORDER = [
  "Hospitalisation", "Outpatient", "Dental", "Optical", "Maternity",
  "Medically assisted reproduction", "Prevention", "Basic repatriation assistance",
];
const SECTION_PT: Record<string, string> = {
  "Hospitalisation": "Hospitalização",
  "Outpatient": "Ambulatorial",
  "Dental": "Dental",
  "Optical": "Óptica",
  "Maternity": "Maternidade",
  "Medically assisted reproduction": "Reprodução assistida",
  "Prevention": "Prevenção",
  "Basic repatriation assistance": "Repatriação",
};

// ── Coverage datatable ────────────────────────────────────────────────────────

function CoverageTable({ rules }: { rules: Rule[] }) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo(() => {
    const present = [...new Set(rules.map((r) => r.section ?? "Outros"))];
    return present.sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a); const ib = SECTION_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rules]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rules
      .filter((r) => !section || (r.section ?? "Outros") === section)
      .filter((r) => {
        if (!needle) return true;
        return [r.benefit_name, r.section, r.coverage_basis, r.notes]
          .some((f) => (f ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const sa = SECTION_ORDER.indexOf(a.section ?? ""); const sb = SECTION_ORDER.indexOf(b.section ?? "");
        if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
        return (a.benefit_name ?? "").localeCompare(b.benefit_name ?? "");
      });
  }, [rules, q, section]);

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar benefício… (ex: fisioterapia, MRI, psicólogo)"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant text-xs outline-none focus:border-primary transition text-on-surface"
          />
        </div>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="px-2.5 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant text-xs outline-none focus:border-primary transition text-on-surface"
        >
          <option value="">Todas as seções</option>
          {sections.map((s) => (
            <option key={s} value={s}>{SECTION_PT[s] ?? s}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container border-b border-outline-variant">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap">Seção</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Benefício</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap">Cobertura</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap hidden sm:table-cell">Exigências</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const open = openId === r.id;
                return (
                  <Row key={r.id} r={r} open={open} onToggle={() => setOpenId(open ? null : r.id)} />
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-xs text-on-surface-variant">
                    Nenhum benefício encontrado para esse filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-on-surface-variant/70 mt-1.5">
        {filtered.length} de {rules.length} benefícios · clique numa linha para ver o texto original da apólice
      </p>
    </div>
  );
}

function Row({ r, open, onToggle }: { r: Rule; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        id={`rule-${r.id}`}
        onClick={onToggle}
        className={`border-b border-outline-variant last:border-0 cursor-pointer transition ${open ? "bg-primary/[0.04]" : "hover:bg-surface-container/60"}`}
      >
        <td className="px-3 py-2 align-top whitespace-nowrap">
          <span className="text-[10px] font-medium text-on-surface-variant">{SECTION_PT[r.section ?? ""] ?? r.section ?? "—"}</span>
        </td>
        <td className="px-3 py-2 align-top">
          <span className="text-xs text-on-surface flex items-start gap-1">
            {open ? <ChevronDown size={11} className="mt-0.5 shrink-0 text-on-surface-variant" /> : <ChevronRight size={11} className="mt-0.5 shrink-0 text-on-surface-variant" />}
            {r.benefit_name ?? "—"}
          </span>
          {r.notes && <p className="text-[10px] text-on-surface-variant mt-0.5 ml-4">{r.notes}</p>}
        </td>
        <td className="px-3 py-2 align-top">
          <span className="text-xs font-medium text-on-surface tabular-nums">{r.coverage_basis ?? "—"}</span>
        </td>
        <td className="px-3 py-2 align-top hidden sm:table-cell">
          <span className="flex flex-wrap gap-1">
            {r.requires_preauth && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/25 font-semibold whitespace-nowrap">pré-autorização</span>
            )}
            {r.requires_prescription && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/25 font-semibold whitespace-nowrap">pedido médico</span>
            )}
            {!r.requires_preauth && !r.requires_prescription && (
              <span className="text-[10px] text-on-surface-variant/50">—</span>
            )}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-outline-variant last:border-0 bg-primary/[0.02]">
          <td colSpan={4} className="px-4 pb-3 pt-0">
            <div className="ml-4 flex flex-wrap gap-2 sm:hidden mb-1">
              {r.requires_preauth && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/25 font-semibold">pré-autorização</span>}
              {r.requires_prescription && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/25 font-semibold">pedido médico</span>}
            </div>
            <div className="ml-4"><SourceQuote text={r.source_quote} /></div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Terms tables ─────────────────────────────────────────────────────────────

function TermTextRow({ t }: { t: Term }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!t.source_quote || !!t.source_document;
  return (
    <>
      <tr
        onClick={() => hasMore && setOpen((v) => !v)}
        className={`border-b border-outline-variant last:border-0 ${hasMore ? "cursor-pointer hover:bg-surface-container/60" : ""} transition`}
      >
        <td className="px-3 py-2">
          {t.title && <p className="text-xs font-medium text-on-surface">{t.title}</p>}
          <p className={`text-[11px] text-on-surface-variant ${t.title ? "mt-0.5" : ""}`}>{t.text}</p>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-outline-variant last:border-0 bg-primary/[0.02]">
          <td className="px-4 pb-3 pt-0">
            {t.source_document && <p className="text-[10px] text-on-surface-variant/60 mb-1">Fonte: {t.source_document}</p>}
            <SourceQuote text={t.source_quote} />
          </td>
        </tr>
      )}
    </>
  );
}

function TermsTable({ title, Icon, cls, terms }: { title: string; Icon: typeof BookOpen; cls: string; terms: Term[] }) {
  if (terms.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className={cls} />
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{title} ({terms.length})</p>
      </div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
        <table className="w-full border-collapse">
          <tbody>
            {terms.map((t) => <TermTextRow key={t.id} t={t} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WaitingPeriodsTable({ terms }: { terms: Term[] }) {
  if (terms.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={13} className="text-[#f59e0b]" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Carências ({terms.length})</p>
      </div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-container border-b border-outline-variant">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Tratamento</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap text-right">Carência</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} className="border-b border-outline-variant last:border-0">
                <td className="px-3 py-2 text-xs text-on-surface">{t.title ?? t.text}</td>
                <td className="px-3 py-2 text-xs font-semibold text-[#f59e0b] whitespace-nowrap text-right tabular-nums">{t.title ? t.text : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PolicyReviewClient() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/health/policy")
      .then((r) => r.json())
      .then((d) => setPolicy(d.policy))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  return (
    <>
      {/* Identity */}
      <div className="mb-5 p-4 rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck size={16} className="text-primary shrink-0" />
          <p className="font-semibold text-sm text-on-surface">{policy.insurer_name} · {policy.plan_name ?? "—"}</p>
          {policy.plan_tier && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">{policy.plan_tier}</span>}
          {policy.cover_zone && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">Zona {policy.cover_zone}</span>}
          {policy.currency && <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{policy.currency}</span>}
        </div>
        <p className="text-[11px] text-on-surface-variant mt-1">{policy.policy_number} · titular {policy.holder_name}</p>

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

      {/* Members */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Users size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Beneficiários ({policy.policy_dependents.length})</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
          <table className="w-full border-collapse text-left">
            <tbody>
              {policy.policy_dependents.map((m) => (
                <tr key={m.id} className="border-b border-outline-variant last:border-0">
                  <td className="px-3 py-2 text-xs text-on-surface">{m.name}</td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant text-right tabular-nums">{fmt(m.birth_date)} · {m.relationship ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coverage — the main datatable */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Cobertura ({policy.policy_coverage_rules.length})</p>
        </div>
        <CoverageTable rules={policy.policy_coverage_rules} />
      </div>

      {/* Waiting periods as a real table */}
      <WaitingPeriodsTable terms={termsByType.get("waiting_period") ?? []} />

      {/* How to file + required documents */}
      <TermsTable title="Como enviar o claim" Icon={Send} cls="text-[#0ea5e9]" terms={termsByType.get("claim_rule") ?? []} />
      <TermsTable title="Documentos exigidos" Icon={ClipboardList} cls="text-[#8b5cf6]" terms={termsByType.get("required_document") ?? []} />

      {/* Exclusions */}
      <TermsTable title="Exclusões" Icon={AlertTriangle} cls="text-red-400" terms={termsByType.get("exclusion") ?? []} />

      {/* Definitions / zones */}
      <TermsTable title="Definições / zonas" Icon={BookOpen} cls="text-on-surface-variant" terms={termsByType.get("definition") ?? []} />
      <TermsTable title="Outros termos" Icon={BookOpen} cls="text-on-surface-variant" terms={termsByType.get("other") ?? []} />

      {/* Documents vault */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} className="text-on-surface-variant" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Documentos no cofre ({policy.policy_documents.length})</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
          <table className="w-full border-collapse text-left">
            <tbody>
              {policy.policy_documents.map((d) => (
                <tr key={d.id} className="border-b border-outline-variant last:border-0">
                  <td className="px-3 py-2 text-xs text-on-surface">{d.file_name}</td>
                  <td className="px-3 py-2 text-[11px] text-on-surface-variant whitespace-nowrap">{d.doc_type ?? "—"}</td>
                  <td className="px-3 py-2 text-[11px] text-on-surface-variant text-right whitespace-nowrap tabular-nums">{fmtBytes(d.byte_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
