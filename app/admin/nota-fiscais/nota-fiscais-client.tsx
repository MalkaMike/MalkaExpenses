"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search, X, Plane, FileText, AlertTriangle, CheckCircle2,
  Clock, ChevronRight, ExternalLink, Loader2,
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return formatDate(s.slice(0, 10));
}

// ─── Types ──────────────────────────────────────────────────────────────────

type NfRow = {
  id: string;
  file_name: string;
  nf_number: string | null;
  emission_date: string | null;
  payment_date: string | null;
  provider_name: string | null;
  provider_cnpj_formatted: string | null;
  patient_name: string | null;
  total_amount: number | null;
  category_slug: string | null;
  is_medical: boolean;
  is_reimbursable: boolean;
  match_confidence: string | null;
  transaction_id: string | null;
  reimbursement_status: string | null;
  source_type: string | null;
  verification_code: string | null;
  service_description: string | null;
  no_match_reason: string | null;
};

type FlightLeg = {
  id: string;
  leg_order: number;
  direction: string | null;
  origin_city: string | null;
  origin_airport: string | null;
  dest_city: string | null;
  dest_airport: string | null;
  departure_date: string | null;
  departure_time: string | null;
  arrival_date: string | null;
  airline: string | null;
  flight_number: string | null;
  booking_ref: string | null;
  passengers: string[] | null;
  fare_class: string | null;
};

type NfDetail = NfRow & {
  nota_fiscal_flights: FlightLeg[];
};

type Stats = {
  total: number;
  grand_total: number;
  matched: number;
  unmatched: number;
  match_rate: number;
  reimbursable_count: number;
  reimbursable_total: number;
  missing_nf_count: number;
  unmatched_pending: number;
  missing_nfs: { transaction_id: string; date: string; description: string; amount: number }[];
};

type ListResp = {
  data: NfRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

// ─── Category + reason meta ──────────────────────────────────────────────────

const CAT_META: Record<string, { label: string; cls: string }> = {
  saude:                  { label: "Saúde",        cls: "bg-[#0ea5e9]/10 text-[#0ea5e9] border-[#0ea5e9]/20" },
  educacao:               { label: "Educação",     cls: "bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/20" },
  cosmeticos:             { label: "Cosméticos",   cls: "bg-[#ec4899]/10 text-[#ec4899] border-[#ec4899]/20" },
  assinaturas:            { label: "Assinaturas",  cls: "bg-[#6366f1]/10 text-[#6366f1] border-[#6366f1]/20" },
  esportes_hobby:         { label: "Esportes",     cls: "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20" },
  viagens:                { label: "Viagens",      cls: "bg-[#14b8a6]/10 text-[#14b8a6] border-[#14b8a6]/20" },
  lazer:                  { label: "Lazer",        cls: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20" },
  casa_decoracao:         { label: "Casa & Decor", cls: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/20" },
  estacionamento_pedagio: { label: "Estacion.",    cls: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20" },
  manutencao_casa:        { label: "Manutenção",   cls: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/20" },
  hoteis_pousadas:        { label: "Hotéis",       cls: "bg-[#14b8a6]/10 text-[#14b8a6] border-[#14b8a6]/20" },
  tecnologia:             { label: "Tecnologia",   cls: "bg-[#64748b]/10 text-[#64748b] border-[#64748b]/20" },
  delivery:               { label: "Delivery",     cls: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20" },
  transporte:             { label: "Transporte",   cls: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20" },
  servicos:               { label: "Serviços",     cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
  outros:                 { label: "Outros",       cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
};

const REASON_META: Record<string, { label: string; cls: string; activeCls: string }> = {
  plano_direto: {
    label: "Plano Direto",
    cls: "border-outline-variant text-on-surface-variant hover:border-[#8b5cf6]/40 hover:text-[#8b5cf6]",
    activeCls: "bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/30",
  },
  dinheiro: {
    label: "Dinheiro",
    cls: "border-outline-variant text-on-surface-variant hover:border-[#10b981]/40 hover:text-[#10b981]",
    activeCls: "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30",
  },
  miles: {
    label: "Milhas",
    cls: "border-outline-variant text-on-surface-variant hover:border-[#0ea5e9]/40 hover:text-[#0ea5e9]",
    activeCls: "bg-[#0ea5e9]/10 text-[#0ea5e9] border-[#0ea5e9]/30",
  },
  pendente: {
    label: "Pendente",
    cls: "border-outline-variant text-on-surface-variant hover:border-[#f59e0b]/40 hover:text-[#f59e0b]",
    activeCls: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30",
  },
};

const REASONS = Object.entries(REASON_META).map(([key, m]) => ({ key, ...m }));

function catMeta(slug: string | null) {
  return CAT_META[slug ?? "outros"] ?? CAT_META.outros;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MatchBadge({ conf }: { conf: string | null }) {
  if (!conf || conf === "none") {
    return <span className="text-[10px] text-red-400 font-medium">sem match</span>;
  }
  const meta: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
    high:   { label: "alto",  cls: "text-[#10b981]", Icon: CheckCircle2 },
    medium: { label: "médio", cls: "text-[#f59e0b]", Icon: Clock },
    low:    { label: "baixo", cls: "text-neutral-400", Icon: Clock },
  };
  const m = meta[conf] ?? meta.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${m.cls}`}>
      <m.Icon size={11} />
      {m.label}
    </span>
  );
}

function StatCard({ label, value, sub, warn, loading, onClick }: {
  label: string; value: string; sub?: string;
  warn?: boolean; loading?: boolean; onClick?: () => void;
}) {
  const cls = `p-3.5 rounded-xl border soft-ambient-shadow text-left transition w-full ${
    warn
      ? "bg-[#f59e0b]/5 border-[#f59e0b]/20 hover:bg-[#f59e0b]/10 cursor-pointer"
      : "bg-surface-container-lowest border-outline-variant"
  }`;
  const inner = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${warn ? "text-[#f59e0b]" : "text-on-surface"}`}>
        {loading ? "—" : value}
      </p>
      <p className="text-[10px] text-on-surface-variant mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-on-surface-variant/60 mt-0.5">{sub}</p>}
    </>
  );
  if (onClick) return <button className={cls} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

function InfoRow({ label, value, bold, mono }: {
  label: string; value: string; bold?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] text-on-surface-variant shrink-0 pt-0.5">{label}</span>
      <span className={`text-[11px] text-on-surface text-right break-all ${bold ? "font-semibold" : ""} ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function FlightCard({ leg }: { leg: FlightLeg }) {
  const dirLabel = { outbound: "Ida", return: "Volta", oneway: "Voo" }[leg.direction ?? ""] ?? leg.direction ?? "Trecho";
  return (
    <div className="p-3 rounded-lg bg-surface-container border border-outline-variant space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{dirLabel}</span>
        {(leg.airline || leg.flight_number) && (
          <span className="text-[10px] text-on-surface-variant">{leg.airline} {leg.flight_number}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="text-center min-w-[48px]">
          <p className="text-lg font-bold text-on-surface leading-none">{leg.origin_airport ?? "—"}</p>
          <p className="text-[10px] text-on-surface-variant leading-none mt-0.5 truncate max-w-[60px]">{leg.origin_city ?? ""}</p>
        </div>
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full flex items-center gap-1">
            <div className="flex-1 h-px bg-outline-variant" />
            <Plane size={11} className="text-on-surface-variant rotate-90" />
            <div className="flex-1 h-px bg-outline-variant" />
          </div>
          {leg.departure_date && (
            <p className="text-[10px] text-on-surface-variant">{fmtDate(leg.departure_date)}</p>
          )}
          {leg.departure_time && (
            <p className="text-[10px] text-on-surface-variant font-mono">{leg.departure_time}</p>
          )}
        </div>
        <div className="text-center min-w-[48px]">
          <p className="text-lg font-bold text-on-surface leading-none">{leg.dest_airport ?? "—"}</p>
          <p className="text-[10px] text-on-surface-variant leading-none mt-0.5 truncate max-w-[60px]">{leg.dest_city ?? ""}</p>
        </div>
      </div>
      <div className="space-y-0.5">
        {leg.passengers && leg.passengers.length > 0 && (
          <p className="text-[10px] text-on-surface-variant">{leg.passengers.join(", ")}</p>
        )}
        {leg.booking_ref && (
          <p className="text-[10px] text-on-surface-variant font-mono">Reserva: {leg.booking_ref}</p>
        )}
      </div>
    </div>
  );
}

function ReasonButtons({
  nf, onSave, saving,
}: {
  nf: NfRow;
  onSave: (id: string, reason: string | null) => void;
  saving: boolean;
}) {
  return (
    <div
      className="flex gap-1.5 flex-wrap mt-2"
      onClick={(e) => e.stopPropagation()}
    >
      {REASONS.map((r) => {
        const active = nf.no_match_reason === r.key;
        return (
          <button
            key={r.key}
            disabled={saving}
            onClick={() => onSave(nf.id, active ? null : r.key)}
            className={`px-2.5 py-1 rounded-full text-[10px] border font-medium transition ${
              active ? r.activeCls : r.cls
            } ${saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function DetailContent({ detail }: { detail: NfDetail }) {
  const isGmail = detail.source_type === "gmail_email";
  const isPortal = detail.source_type === "nfse_portal";
  const flights = [...(detail.nota_fiscal_flights ?? [])].sort((a, b) => a.leg_order - b.leg_order);

  return (
    <div className="overflow-y-auto">
      <div className="px-5 py-4 space-y-2">
        <InfoRow label="Data" value={fmtDate(detail.emission_date ?? detail.payment_date)} />
        <InfoRow label="Valor" value={formatBRL(Number(detail.total_amount ?? 0))} bold />
        <InfoRow label="Categoria" value={catMeta(detail.category_slug).label} />
        {detail.patient_name && <InfoRow label="Paciente" value={detail.patient_name} />}
        {detail.provider_cnpj_formatted && <InfoRow label="CNPJ" value={detail.provider_cnpj_formatted} mono />}
        {detail.nf_number && <InfoRow label="Número NF" value={detail.nf_number} />}
        {detail.verification_code && <InfoRow label="Cód. verificação" value={detail.verification_code} mono />}
        {detail.service_description && (
          <InfoRow label="Serviço" value={detail.service_description.slice(0, 120)} />
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-on-surface-variant">Indexação</span>
          <MatchBadge conf={detail.match_confidence} />
        </div>
        {detail.is_reimbursable && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <CheckCircle2 size={12} className="text-[#10b981]" />
            <span className="text-[11px] text-[#10b981] font-medium">Reembolsável</span>
          </div>
        )}
      </div>

      {isGmail && flights.length > 0 && (
        <>
          <div className="mx-5 border-t border-outline-variant" />
          <div className="px-5 py-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Trechos</p>
            {flights.map((leg) => <FlightCard key={leg.id} leg={leg} />)}
          </div>
        </>
      )}

      {!isGmail && !isPortal && (
        <>
          <div className="mx-5 border-t border-outline-variant" />
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Documento PDF</p>
              <a
                href={`/api/admin/nota-fiscais/${detail.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink size={11} />
                Abrir
              </a>
            </div>
            <iframe
              src={`/api/admin/nota-fiscais/${detail.id}/pdf`}
              className="w-full rounded-xl border border-outline-variant bg-surface-container"
              style={{ height: 520 }}
              title="Nota Fiscal"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NotaFiscaisClient() {
  const [activeTab, setActiveTab] = useState<"all" | "unmatched">("all");

  // Filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  // Data
  const [stats, setStats] = useState<Stats | null>(null);
  const [list, setList] = useState<ListResp | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingList, setLoadingList] = useState(true);

  // Detail modal
  const [selected, setSelected] = useState<NfRow | null>(null);
  const [detail, setDetail] = useState<NfDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Missing NFs panel
  const [showMissing, setShowMissing] = useState(false);

  // Reason saving
  const [savingReason, setSavingReason] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 380);
    return () => clearTimeout(t);
  }, [q]);

  // Reset page on filter/tab change
  useEffect(() => { setPage(1); }, [debouncedQ, category, activeTab]);

  // Load stats (once)
  useEffect(() => {
    setLoadingStats(true);
    fetch("/api/admin/nota-fiscais/stats")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoadingStats(false));
  }, []);

  // Load list
  useEffect(() => {
    setLoadingList(true);
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (category) p.set("category", category);
    if (activeTab === "unmatched") p.set("unmatched", "true");
    p.set("page", String(page));
    p.set("per_page", "30");
    fetch(`/api/admin/nota-fiscais?${p}`)
      .then((r) => r.json())
      .then(setList)
      .finally(() => setLoadingList(false));
  }, [debouncedQ, category, activeTab, page]);

  // Load detail on row click
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setLoadingDetail(true);
    setDetail(null);
    fetch(`/api/admin/nota-fiscais/${selected.id}`)
      .then((r) => r.json())
      .then(setDetail)
      .finally(() => setLoadingDetail(false));
  }, [selected?.id]);

  const saveReason = useCallback(async (nfId: string, reason: string | null) => {
    setSavingReason(nfId);
    try {
      await fetch(`/api/admin/nota-fiscais/${nfId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no_match_reason: reason }),
      });
      setList((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: prev.data.map((r) =>
            r.id === nfId ? { ...r, no_match_reason: reason } : r
          ),
        };
      });
      // Recount unmatched_pending in stats
      setStats((prev) => {
        if (!prev) return prev;
        const wasClassified = prev.unmatched_pending;
        const delta = reason ? -1 : 1;
        return { ...prev, unmatched_pending: Math.max(0, wasClassified + delta) };
      });
    } finally {
      setSavingReason(null);
    }
  }, []);

  const rows = list?.data ?? [];

  function openRow(row: NfRow) {
    setSelected((prev) => (prev?.id === row.id ? null : row));
  }

  const tabItems = [
    { key: "all" as const,       label: "Todas",          count: stats?.total },
    { key: "unmatched" as const, label: "Sem Transação",  count: stats?.unmatched, pendingCount: stats?.unmatched_pending, warn: true },
  ];

  return (
    <>
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Notas Fiscais"
          value={String(stats?.total ?? "—")}
          sub={stats ? formatBRL(stats.grand_total) : ""}
          loading={loadingStats}
        />
        <StatCard
          label="Indexadas"
          value={stats ? `${stats.match_rate}%` : "—"}
          sub={stats ? `${stats.matched} de ${stats.total}` : ""}
          loading={loadingStats}
        />
        <StatCard
          label="Reembolsável"
          value={stats ? formatBRL(stats.reimbursable_total) : "—"}
          sub={stats ? `${stats.reimbursable_count} NFs` : ""}
          loading={loadingStats}
        />
        <StatCard
          label="Sem NF vinculada"
          value={String(stats?.missing_nf_count ?? "—")}
          sub="transações saúde/educação"
          warn={!!stats && stats.missing_nf_count > 0}
          loading={loadingStats}
          onClick={() => setShowMissing((v) => !v)}
        />
      </div>

      {/* Missing NFs panel */}
      {showMissing && stats && stats.missing_nfs.length > 0 && (
        <div className="mb-5 p-4 rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={13} className="text-[#f59e0b] shrink-0" />
            <p className="text-xs font-semibold text-on-surface">
              Transações de saúde/educação sem NF vinculada
            </p>
          </div>
          <div className="space-y-0.5">
            {stats.missing_nfs.map((tx) => (
              <div
                key={tx.transaction_id}
                className="flex items-center justify-between py-2 border-b border-[#f59e0b]/10 last:border-0"
              >
                <div>
                  <p className="text-xs text-on-surface">{tx.description}</p>
                  <p className="text-[10px] text-on-surface-variant">{fmtDate(tx.date)}</p>
                </div>
                <p className="text-xs font-semibold tabular-nums text-on-surface ml-4">
                  {formatBRL(-tx.amount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-0 mb-4 border-b border-outline-variant">
        {tabItems.map(({ key, label, count, pendingCount, warn }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {label}
              {count !== undefined && (
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 tabular-nums font-semibold ${
                  active
                    ? "bg-primary/10 text-primary"
                    : warn
                    ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                    : "bg-surface-container text-on-surface-variant"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {activeTab === "unmatched" && stats && stats.unmatched_pending > 0 && (
          <span className="ml-auto self-center text-[10px] text-on-surface-variant px-2">
            {stats.unmatched_pending} sem classificação
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fornecedor, NF, texto…"
            className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:outline-none focus:border-primary transition"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:outline-none focus:border-primary transition"
        >
          <option value="">Todas as categorias</option>
          <option value="saude">Saúde</option>
          <option value="educacao">Educação</option>
          <option value="cosmeticos">Cosméticos</option>
          <option value="assinaturas">Assinaturas</option>
          <option value="esportes_hobby">Esportes</option>
          <option value="viagens">Viagens</option>
          <option value="lazer">Lazer</option>
          <option value="casa_decoracao">Casa & Decor</option>
          <option value="hoteis_pousadas">Hotéis</option>
          <option value="estacionamento_pedagio">Estacionamento</option>
          <option value="tecnologia">Tecnologia</option>
          <option value="outros">Outros</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-outline-variant overflow-hidden bg-surface-container-lowest">
        {/* Header */}
        {activeTab === "all" && (
          <div className="grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-0 border-b border-outline-variant bg-surface-container px-4 py-2.5">
            {["Data", "Fornecedor", "Valor", "Categoria", ""].map((h, i) => (
              <p key={i} className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{h}</p>
            ))}
          </div>
        )}
        {activeTab === "unmatched" && (
          <div className="grid grid-cols-[80px_1fr_80px] gap-0 border-b border-outline-variant bg-surface-container px-4 py-2.5">
            {["Data", "Fornecedor · Valor · Razão", "Cat."].map((h, i) => (
              <p key={i} className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{h}</p>
            ))}
          </div>
        )}

        {loadingList && (
          <div className="flex items-center justify-center py-14">
            <Loader2 size={20} className="animate-spin text-on-surface-variant" />
          </div>
        )}

        {!loadingList && rows.length === 0 && (
          <div className="text-center py-14 text-sm text-on-surface-variant">
            {activeTab === "unmatched" ? "Todas as NFs já têm transação vinculada" : "Nenhuma nota fiscal encontrada"}
          </div>
        )}

        {!loadingList && rows.length > 0 && activeTab === "all" && (
          <div className="divide-y divide-outline-variant">
            {rows.map((row) => {
              const cat = catMeta(row.category_slug);
              const dateStr = row.emission_date ?? row.payment_date ?? "";
              return (
                <button
                  key={row.id}
                  onClick={() => openRow(row)}
                  className={`w-full grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-0 px-4 py-3 text-left transition hover:bg-surface-container active:scale-[0.99] ${
                    selected?.id === row.id ? "bg-primary/5" : ""
                  }`}
                >
                  <div>
                    <p className="text-xs tabular-nums text-on-surface-variant whitespace-nowrap">
                      {fmtDate(dateStr)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    {row.source_type === "gmail_email"
                      ? <Plane size={12} className="text-[#0ea5e9] shrink-0" />
                      : <FileText size={12} className="text-on-surface-variant shrink-0" />
                    }
                    <div className="min-w-0">
                      <p className="text-xs text-on-surface truncate">{row.provider_name ?? "—"}</p>
                      {row.patient_name && row.patient_name !== "Mickael" && (
                        <p className="text-[10px] text-on-surface-variant">{row.patient_name}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs tabular-nums font-semibold text-on-surface">
                      {formatBRL(Number(row.total_amount ?? 0))}
                    </p>
                    <MatchBadge conf={row.match_confidence} />
                  </div>
                  <div>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] border ${cat.cls}`}>
                      {cat.label}
                    </span>
                    {row.is_reimbursable && (
                      <p className="text-[10px] text-[#10b981] mt-0.5 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> reimb.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center">
                    <ChevronRight size={14} className="text-on-surface-variant" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loadingList && rows.length > 0 && activeTab === "unmatched" && (
          <div className="divide-y divide-outline-variant">
            {rows.map((row) => {
              const cat = catMeta(row.category_slug);
              const dateStr = row.emission_date ?? row.payment_date ?? "";
              const isSaving = savingReason === row.id;
              return (
                <button
                  key={row.id}
                  onClick={() => openRow(row)}
                  className={`w-full grid grid-cols-[80px_1fr_80px] gap-0 px-4 py-3 text-left transition hover:bg-surface-container ${
                    selected?.id === row.id ? "bg-primary/5" : ""
                  }`}
                >
                  {/* Date */}
                  <div className="pt-0.5">
                    <p className="text-[11px] tabular-nums text-on-surface-variant whitespace-nowrap">
                      {fmtDate(dateStr)}
                    </p>
                  </div>

                  {/* Provider + amount + reason buttons */}
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {row.source_type === "gmail_email"
                        ? <Plane size={11} className="text-[#0ea5e9] shrink-0" />
                        : <FileText size={11} className="text-on-surface-variant/60 shrink-0" />
                      }
                      <p className="text-xs text-on-surface truncate">{row.provider_name ?? "—"}</p>
                      <span className="text-[10px] text-on-surface-variant shrink-0">·</span>
                      <p className="text-[11px] tabular-nums font-semibold text-on-surface shrink-0">
                        {formatBRL(Number(row.total_amount ?? 0))}
                      </p>
                      {isSaving && <Loader2 size={10} className="animate-spin text-on-surface-variant shrink-0 ml-1" />}
                    </div>
                    {row.patient_name && row.patient_name !== "Mickael" && (
                      <p className="text-[10px] text-on-surface-variant mt-0.5 ml-[15px]">{row.patient_name}</p>
                    )}
                    <ReasonButtons nf={row} onSave={saveReason} saving={isSaving} />
                  </div>

                  {/* Category */}
                  <div className="flex items-start justify-end pt-0.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] border ${cat.cls}`}>
                      {cat.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {list && list.total_pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs text-on-surface-variant">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container transition"
          >
            Anterior
          </button>
          <span>
            {page} / {list.total_pages} &mdash; {list.total} NF(s)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(list.total_pages, p + 1))}
            disabled={page === list.total_pages}
            className="px-3 py-1.5 rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container transition"
          >
            Próxima
          </button>
        </div>
      )}
      {list && list.total_pages <= 1 && list.total > 0 && (
        <p className="mt-3 text-xs text-center text-on-surface-variant">{list.total} nota(s) fiscal(is)</p>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pb-4 bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <div className="w-full max-w-2xl max-h-[85vh] bg-surface rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-outline-variant">
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selected.source_type === "gmail_email"
                  ? <Plane size={15} className="text-[#0ea5e9] shrink-0" />
                  : <FileText size={15} className="text-on-surface-variant shrink-0" />
                }
                <p className="font-semibold text-on-surface text-sm truncate">
                  {selected.provider_name ?? selected.nf_number ?? "Detalhe"}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-on-surface-variant hover:text-on-surface transition ml-3 shrink-0"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-on-surface-variant" />
                </div>
              ) : detail ? (
                <DetailContent detail={detail} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
