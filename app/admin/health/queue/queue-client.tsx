"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CheckCircle2, Send, Loader2, AlertTriangle, FileText, ChevronLeft,
  Stethoscope, User, Building2, Phone, ArrowRight, Wallet,
  ClipboardList, Upload, Paperclip
} from "lucide-react";
import { formatDate, formatBRL } from "@/lib/format";
import {
  STATE_LABEL, STATE_ORDER, NEXT_ACTION, type ClaimState
} from "@/lib/health/claim-status";
import {
  GAP_LABEL, PATIENT_SOURCE_LABEL, REQUIRED_DOCUMENTS,
  type ClaimGap, type PatientSource
} from "@/lib/health/claim-info";
import {
  OWNER_LABEL, INSURER_LABEL, type ClaimOwner, type Guidance, type Insurer
} from "@/lib/health/claim-guidance";

type Claim = {
  id: string;
  nfNumber: string | null;
  emissionDate: string | null;
  providerName: string | null;
  cnpj: string | null;
  doctorName: string | null;
  council: { council: string; number: string; uf: string | null } | null;
  specialty: string | null;
  clinic: string | null;
  phone: string | null;
  patient: string | null;
  patientSource: PatientSource;
  patientConfirmed: boolean;
  amount: number | null;
  serviceDescription: string | null;
  hasPdf: boolean;
  matchedPayment: boolean;
  state: ClaimState;
  reimbursedAmount: number | null;
  submittedAt: string | null;
  notes: string | null;
  gaps: ClaimGap[];
  guidance: Guidance;
  insurer: Insurer;
};

const OWNER_CLS: Record<ClaimOwner, string> = {
  secretary: "text-primary bg-primary/10",
  mickael: "text-[#8b5cf6] bg-[#8b5cf6]/10",
  blocked: "text-on-surface-variant bg-on-surface-variant/10"
};

const STATE_CLS: Record<ClaimState, string> = {
  not_submitted: "text-[#f59e0b] bg-[#f59e0b]/10",
  with_secretary: "text-primary bg-primary/10",
  submitted: "text-[#3b82f6] bg-[#3b82f6]/10",
  reimbursed: "text-[#10b981] bg-[#10b981]/10",
  rejected: "text-red-400 bg-red-400/10"
};

function fmt(d: string | null) {
  return d ? formatDate(d.slice(0, 10)) : "—";
}

type Attachment = { name: string; size: number | null; uploadedAt: string | null; url: string };

/**
 * Documents the secretary collects for this claim. They are parked here so the
 * whole set can be attached to one email to the insurer later — which is why
 * the count is what matters, not any single file.
 */
function Attachments({ claimId }: { claimId: string }) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/health/queue/${claimId}/attachments`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setFiles(d.attachments ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await fetch(`/api/admin/health/queue/${claimId}/attachments`, { method: "POST", body });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
        <Paperclip size={11} /> Documentos guardados ({files.length})
      </p>
      <p className="text-[11px] text-on-surface-variant">
        Guarde aqui o laudo do médico e o comprovante de pagamento. O Mickael envia tudo junto ao seguro depois.
      </p>

      {loading && <Loader2 size={14} className="animate-spin text-on-surface-variant" />}

      {!loading && files.length === 0 && (
        <p className="text-[11px] text-[#f59e0b]">Nenhum documento guardado ainda.</p>
      )}

      {files.map((f) => (
        <a
          key={f.name}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-[12px] text-primary hover:underline"
        >
          <FileText size={12} className="shrink-0" />
          <span className="truncate">{f.name}</span>
          {f.size != null && (
            <span className="text-on-surface-variant shrink-0">
              {(f.size / 1024).toFixed(0)} KB
            </span>
          )}
        </a>
      ))}

      <input
        ref={input}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={busy}
        className="w-full py-2.5 rounded-xl bg-primary/10 text-primary font-semibold text-sm hover:bg-primary/15 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {busy ? "Enviando..." : "Guardar documento"}
      </button>

      {err && (
        <p className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {err}
        </p>
      )}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`text-sm text-on-surface ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── detail

function Detail({
  claim, onBack, onAdvance, busy, error
}: {
  claim: Claim;
  onBack: () => void;
  onAdvance: (to: ClaimState, extra: { amount?: number; submittedAt?: string }) => void;
  busy: boolean;
  error: string | null;
}) {
  const [amount, setAmount] = useState("");
  const [sentDate, setSentDate] = useState("");
  const next = NEXT_ACTION[claim.state];

  // Reset the inputs when a different invoice is opened, so a value typed for
  // one claim can never be submitted against another.
  useEffect(() => { setAmount(""); setSentDate(""); }, [claim.id]);

  const blocking = claim.gaps.filter((g) => g === "patient_unknown" || g === "no_pdf");

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="lg:hidden inline-flex items-center gap-1 text-xs text-on-surface-variant"
      >
        <ChevronLeft size={14} /> Voltar à lista
      </button>

      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-on-surface leading-snug">
            {claim.providerName ?? "—"}
          </h2>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg ${STATE_CLS[claim.state]}`}>
            {STATE_LABEL[claim.state]}
          </span>
        </div>
        <p className="text-2xl font-bold text-on-surface tabular-nums">
          {claim.amount != null ? formatBRL(claim.amount) : "—"}
        </p>
        {claim.state === "reimbursed" && claim.reimbursedAmount != null && (
          <p className="text-xs text-[#10b981] flex items-center gap-1">
            <Wallet size={12} /> Reembolsado {formatBRL(claim.reimbursedAmount)}
          </p>
        )}
      </header>

      {/* The instruction comes first — it is why she opened the card. */}
      <section className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
            <ClipboardList size={11} /> O que pedir
          </p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${OWNER_CLS[claim.guidance.owner]}`}>
            {OWNER_LABEL[claim.guidance.owner]}
          </span>
        </div>

        {claim.guidance.groupLabel && (
          <p className="text-[11px] font-semibold text-on-surface">{claim.guidance.groupLabel}</p>
        )}

        <ol className="space-y-1.5">
          {claim.guidance.ask.map((a, i) => (
            <li key={a} className="text-[12px] text-on-surface flex gap-2">
              <span className="text-primary font-bold shrink-0">{i + 1}.</span>
              <span>{a}</span>
            </li>
          ))}
        </ol>

        {claim.guidance.warning && (
          <p className="text-[11px] text-[#f59e0b] flex items-start gap-1.5 pt-1">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>{claim.guidance.warning}</span>
          </p>
        )}

        {claim.guidance.owner === "mickael" && (
          <p className="text-[11px] text-[#8b5cf6]">Não é com você — o Mickael cuida desta.</p>
        )}
        {claim.guidance.owner === "blocked" && (
          <p className="text-[11px] text-on-surface-variant">
            Não acione o prestador ainda — aguarda resposta do corretor.
          </p>
        )}
      </section>

      {claim.insurer === "anterior" && (
        <p className="text-[11px] text-[#f59e0b] flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          Atendimento anterior a 25/02/2026 — é do {INSURER_LABEL.anterior}, NÃO enviar para a APRIL.
        </p>
      )}

      {claim.gaps.length > 0 && (
        <div className="rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#f59e0b] flex items-center gap-1">
            <AlertTriangle size={11} /> Falta nesta nota
          </p>
          {claim.gaps.map((g) => (
            <p key={g} className="text-[11px] text-on-surface-variant">• {GAP_LABEL[g]}</p>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-outline-variant p-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
          <Stethoscope size={11} /> Médico
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" value={claim.doctorName} />
          <Field
            label="Registro"
            mono
            value={claim.council ? `${claim.council.council} ${claim.council.number}${claim.council.uf ? `-${claim.council.uf}` : ""}` : null}
          />
          <Field label="Especialidade" value={claim.specialty} />
          <Field label="Clínica" value={claim.clinic} />
        </div>
        {claim.phone && (
          <a href={`tel:${claim.phone}`} className="inline-flex items-center gap-1.5 text-xs text-primary">
            <Phone size={12} /> {claim.phone}
          </a>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant p-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
          <User size={11} /> Paciente
        </p>
        <p className="text-sm font-semibold text-on-surface">{claim.patient ?? "não identificado"}</p>
        <p className={`text-[11px] ${claim.patientConfirmed ? "text-on-surface-variant" : "text-[#f59e0b]"}`}>
          {PATIENT_SOURCE_LABEL[claim.patientSource]}
          {!claim.patientConfirmed && claim.patient && " — confirme antes de enviar"}
        </p>
      </section>

      <section className="rounded-xl border border-outline-variant p-4 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
          <Building2 size={11} /> Nota fiscal
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Número" value={claim.nfNumber} mono />
          <Field label="Emissão" value={fmt(claim.emissionDate)} />
          <Field label="CNPJ" value={claim.cnpj} mono />
          <Field label="Pagamento casado" value={claim.matchedPayment ? "sim" : "não"} />
        </div>
        {claim.hasPdf ? (
          <a
            href={`/api/admin/nota-fiscais/${claim.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="w-full py-2.5 rounded-xl bg-primary/10 text-primary font-semibold text-sm hover:bg-primary/15 transition flex items-center justify-center gap-2"
          >
            <FileText size={14} /> Abrir PDF da nota
          </a>
        ) : (
          <p className="text-[11px] text-red-400 flex items-center gap-1">
            <AlertTriangle size={11} /> Sem PDF — peça a 2ª via ao prestador
          </p>
        )}
      </section>

      {claim.serviceDescription && (
        <section className="rounded-xl border border-outline-variant p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
            Descrição do serviço
          </p>
          <p className="text-[11px] text-on-surface-variant whitespace-pre-wrap leading-relaxed">
            {claim.serviceDescription}
          </p>
        </section>
      )}

      <Attachments claimId={claim.id} />

      <section className="rounded-xl border border-outline-variant p-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
          O plano exige anexar
        </p>
        {REQUIRED_DOCUMENTS.map((d) => (
          <p key={d} className="text-[11px] text-on-surface-variant flex gap-1.5">
            <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-on-surface-variant" /> {d}
          </p>
        ))}
      </section>

      {next && (
        <section className="space-y-3">
          {next.to === "submitted" && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                Data do envio (deixe vazio para hoje)
              </span>
              <input
                type="date"
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant text-sm text-on-surface"
              />
            </label>
          )}
          {next.to === "reimbursed" && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                Valor reembolsado pelo plano (R$)
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="mt-1 w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant text-sm text-on-surface tabular-nums"
              />
            </label>
          )}

          {blocking.length > 0 && (
            <p className="text-[11px] text-[#f59e0b] flex items-start gap-1">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              Resolva as pendências acima antes de enviar — o plano recusa sem isso.
            </p>
          )}

          <button
            onClick={() =>
              onAdvance(next.to, {
                ...(next.to === "reimbursed" ? { amount: Number(amount.replace(",", ".")) } : {}),
                ...(next.to === "submitted" && sentDate ? { submittedAt: sentDate } : {})
              })
            }
            disabled={busy}
            className="w-full py-3 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {next.label}
          </button>
        </section>
      )}

      {claim.state === "submitted" && claim.submittedAt && (
        <p className="text-[11px] text-on-surface-variant flex items-center gap-1">
          <Send size={11} /> Enviado ao seguro em {fmt(claim.submittedAt)}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── page

export function QueueClient() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/admin/health/queue");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setClaims(d.claims ?? []);
      setWarnings(d.warnings ?? []);
    } catch (e) {
      // A failed load must look failed — an empty list would read as
      // "nothing to do", which is exactly the wrong message here.
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = claims.find((c) => c.id === selectedId) ?? null;

  async function advance(to: ClaimState, extra: { amount?: number; submittedAt?: string }) {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`/api/admin/health/queue/${selected.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, ...extra })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(
    () => STATE_ORDER.map((s) => ({ state: s, items: claims.filter((c) => c.state === s) }))
      .filter((g) => g.items.length > 0),
    [claims]
  );

  const pendingTotal = useMemo(
    () => claims.filter((c) => c.state !== "reimbursed").reduce((s, c) => s + (c.amount ?? 0), 0),
    [claims]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={22} className="animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 space-y-2">
        <p className="text-sm text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={14} /> Não consegui carregar a fila
        </p>
        <p className="text-[11px] text-on-surface-variant">{loadError}</p>
        <button onClick={load} className="text-xs text-primary font-semibold">Tentar de novo</button>
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-on-surface-variant">
        Nenhuma nota médica cadastrada.
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
      {/* list */}
      <div className={`${selected ? "hidden lg:block" : ""} space-y-5`}>
        {warnings.map((w) => (
          <p key={w} className="text-[11px] text-[#f59e0b] flex items-start gap-1">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}
          </p>
        ))}

        <div className="rounded-xl border border-outline-variant p-3">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant">A receber do plano</p>
          <p className="text-lg font-bold text-on-surface tabular-nums">{formatBRL(pendingTotal)}</p>
        </div>

        {groups.map((g) => (
          <section key={g.state}>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
              {STATE_LABEL[g.state]} ({g.items.length})
            </h2>
            <div className="space-y-2">
              {g.items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedId(c.id); setActionError(null); }}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    c.id === selectedId
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant bg-surface-container-lowest hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-on-surface truncate">{c.providerName ?? "—"}</p>
                    <span className="text-sm font-semibold text-on-surface tabular-nums shrink-0">
                      {c.amount != null ? formatBRL(c.amount) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] text-on-surface-variant">{fmt(c.emissionDate)}</span>
                    {c.patient && <span className="text-[10px] text-on-surface-variant">· {c.patient}</span>}
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${OWNER_CLS[c.guidance.owner]}`}>
                      {OWNER_LABEL[c.guidance.owner]}
                    </span>
                    {c.insurer === "anterior" && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-[#f59e0b] bg-[#f59e0b]/10">
                        Bradesco
                      </span>
                    )}
                    {c.gaps.length > 0 && (
                      <span className="text-[10px] text-[#f59e0b] inline-flex items-center gap-0.5">
                        <AlertTriangle size={9} /> {c.gaps.length}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* detail */}
      <div className={selected ? "" : "hidden lg:block"}>
        {selected ? (
          <Detail
            claim={selected}
            onBack={() => setSelectedId(null)}
            onAdvance={advance}
            busy={busy}
            error={actionError}
          />
        ) : (
          <div className="hidden lg:flex items-center justify-center h-full text-sm text-on-surface-variant">
            Escolha uma nota à esquerda.
          </div>
        )}
      </div>
    </div>
  );
}
