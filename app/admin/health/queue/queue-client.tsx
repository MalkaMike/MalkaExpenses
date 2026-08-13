"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Send, Loader2, AlertTriangle, FileText, X, Phone,
  ArrowRight, Wallet, Paperclip, ClipboardList, Upload, Camera,
  ChevronUp, ChevronDown, Search, RotateCcw
} from "lucide-react";
import { formatDate, formatBRL } from "@/lib/format";
import { STATE_LABEL, NEXT_ACTION, type ClaimState } from "@/lib/health/claim-status";
import { sortClaims, defaultDir, type SortKey } from "@/lib/health/claim-sort";
import {
  GAP_LABEL, PATIENT_SOURCE_LABEL, REQUIRED_DOCUMENTS,
  type ClaimGap, type PatientSource
} from "@/lib/health/claim-info";
import {
  OWNER_LABEL, INSURER_LABEL, type Guidance, type Insurer
} from "@/lib/health/claim-guidance";
import type { Role } from "@/lib/auth/admin";

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
  attachmentCount: number | null;
};

/** Gaps that get the claim refused. The rest are hints, not blockers. */
const BLOCKING: ClaimGap[] = ["patient_unknown", "no_pdf"];
const isBlocked = (c: Claim) => c.gaps.some((g) => BLOCKING.includes(g));

function fmt(d: string | null) {
  return d ? formatDate(d.slice(0, 10)) : "—";
}

/** Digits only, with the country code, for a wa.me link. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

// ─────────────────────────────────────────────────────── shared atoms

/**
 * Apple has one filled colour and one outlined colour. Everything interactive
 * is a capsule; nothing carries a shadow.
 */
const PILL_FILLED =
  "inline-flex items-center justify-center gap-2 rounded-ap-pill bg-apple-blue px-5 py-3 " +
  "text-ap-body font-normal text-white transition hover:opacity-90 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

const PILL_OUTLINED =
  "inline-flex items-center justify-center gap-2 rounded-ap-pill border border-link-blue px-5 py-3 " +
  "text-ap-body font-normal text-link-blue transition hover:bg-link-blue/5 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

/** 8px radius, hairline border, no shadow — the only card in the system. */
const CARD = "rounded-ap-card border border-hairline bg-white";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ap-caption font-semibold uppercase tracking-wide text-ash">{children}</p>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className={`mt-0.5 text-ap-body-sm text-carbon ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}

/** Attention without colour-screaming: hairline box, carbon text, one icon. */
function Notice({
  tone = "warn",
  children
}: {
  tone?: "warn" | "error";
  children: React.ReactNode;
}) {
  const icon = tone === "error" ? "text-error" : "text-carbon";
  return (
    <div className={`${CARD} flex gap-2.5 p-3.5`}>
      <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${icon}`} />
      <div className="text-ap-body-sm text-carbon">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── attachments

type Attachment = { name: string; size: number | null; uploadedAt: string | null; url: string };
type Pending = { file: File; name: string; error: string | null };

/**
 * The documents she collects. The old version gave no feedback at all: a repeat
 * upload re-rendered an identical list and she could not tell whether anything
 * had been saved — so this states pending, success and failure explicitly, and
 * a failure keeps the File so "try again" does not mean "find it on disk again".
 */
function Attachments({
  claimId,
  onCountChange
}: {
  claimId: string;
  onCountChange: (n: number) => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`/api/admin/health/queue/${claimId}/attachments`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setFiles(d.attachments ?? []);
      onCountChange((d.attachments ?? []).length);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [claimId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const upload = useCallback(async (file: File) => {
    setPending({ file, name: file.name, error: null });
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await fetch(`/api/admin/health/queue/${claimId}/attachments`, {
        method: "POST",
        body
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setPending(null);
      setJustSaved(d.name);
      toast.success(
        d.renamed
          ? `Guardei como "${d.name}" — já existia um com esse nome`
          : `"${d.name}" guardado`
      );
      await load();
    } catch (e) {
      // Keep the File: retry must not send her back to the file picker.
      setPending((p) => (p ? { ...p, error: (e as Error).message } : p));
    }
  }, [claimId, load]);

  const count = files.length;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Label>Documentos guardados</Label>
        <span className="text-ap-caption text-ash">{loading ? "—" : count}</span>
      </div>
      <p className="text-ap-body-sm text-ash">
        Guarde aqui o laudo do médico e o comprovante de pagamento. O Mickael envia tudo
        junto ao seguro depois.
      </p>

      {loading && <Loader2 size={16} className="animate-spin text-ash" />}

      {loadError && (
        <Notice tone="error">
          Não consegui ler os documentos: {loadError}
          <button onClick={load} className="ml-1 font-semibold text-link-blue underline">
            tentar de novo
          </button>
        </Notice>
      )}

      {!loading && !loadError && count === 0 && !pending && (
        <p className="text-ap-body-sm text-ash">Nenhum documento guardado ainda.</p>
      )}

      {files.map((f) => (
        <a
          key={f.name}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className={`${CARD} flex items-center gap-2.5 px-3.5 py-3 transition hover:border-link-blue`}
        >
          <FileText size={16} className="shrink-0 text-ash" />
          <span className="min-w-0 flex-1 truncate text-ap-body-sm text-carbon">{f.name}</span>
          <span className="shrink-0 text-ap-caption tabular-nums text-ash">
            {f.size != null && `${(f.size / 1024).toFixed(0)} KB`}
            {f.uploadedAt && ` · ${fmt(f.uploadedAt)}`}
          </span>
          {justSaved === f.name && (
            <CheckCircle2 size={16} className="shrink-0 text-link-blue" aria-label="guardado agora" />
          )}
        </a>
      ))}

      {pending && (
        <div className={`${CARD} px-3.5 py-3`}>
          {pending.error ? (
            <>
              <p className="text-ap-body-sm text-carbon">
                Não consegui guardar &quot;{pending.name}&quot; — {pending.error}
              </p>
              <button
                onClick={() => upload(pending.file)}
                className="mt-1.5 inline-flex items-center gap-1 text-ap-body-sm font-semibold text-link-blue underline"
              >
                <RotateCcw size={13} /> Tentar de novo
              </button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-ap-body-sm text-ash">
              <Loader2 size={15} className="animate-spin" />
              Enviando &quot;{pending.name}&quot; ({(pending.file.size / 1048576).toFixed(1)} MB)...
            </p>
          )}
        </div>
      )}

      {/* Server whitelist, exactly — a wider accept only produces a rejection
          after the upload round-trip. */}
      <input
        ref={picker}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => picker.current?.click()}
          disabled={!!pending && !pending.error}
          className={PILL_OUTLINED}
        >
          <Upload size={15} /> Guardar documento
        </button>
        <button
          onClick={() => camera.current?.click()}
          disabled={!!pending && !pending.error}
          className={`${PILL_OUTLINED} sm:hidden`}
        >
          <Camera size={15} /> Tirar foto
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────── detail card

function Detail({
  claim, onClose, onAdvance, onCountChange, busy, error
}: {
  claim: Claim;
  onClose: () => void;
  onAdvance: (to: ClaimState, extra: { amount?: number; submittedAt?: string }) => void;
  onCountChange: (id: string, n: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const [amount, setAmount] = useState("");
  const [sentDate, setSentDate] = useState("");
  const next = NEXT_ACTION[claim.state];

  // Reset when a different invoice is opened, so a value typed for one claim
  // can never be submitted against another.
  useEffect(() => { setAmount(""); setSentDate(""); }, [claim.id]);

  const countChanged = useCallback((n: number) => onCountChange(claim.id, n), [claim.id, onCountChange]);
  const blocking = claim.gaps.filter((g) => BLOCKING.includes(g));
  const hints = claim.gaps.filter((g) => !BLOCKING.includes(g));

  return (
    <div>
      {/* Sticky, so the way out never scrolls away. */}
      <header className="sticky top-0 z-10 -mx-5 -mt-5 mb-6 border-b border-hairline bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="claim-title" className="text-ap-subheading font-semibold leading-tight text-carbon">
              {claim.providerName ?? "—"}
            </h2>
            <p className="mt-1 text-ap-heading-sm font-semibold tabular-nums text-carbon">
              {claim.amount != null ? formatBRL(claim.amount) : "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-2 shrink-0 rounded-ap-pill p-2.5 text-ash transition hover:bg-frost"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-ap-pill bg-pebble px-3 py-1 text-ap-caption font-semibold text-carbon">
            {STATE_LABEL[claim.state]}
          </span>
          {claim.insurer === "anterior" && (
            <span className="rounded-ap-pill border border-hairline px-3 py-1 text-ap-caption font-semibold text-carbon">
              {INSURER_LABEL.anterior} — não enviar à APRIL
            </span>
          )}
        </div>
        {claim.state === "reimbursed" && claim.reimbursedAmount != null && (
          <p className="mt-2 flex items-center gap-1.5 text-ap-body-sm text-carbon">
            <Wallet size={14} /> Reembolsado {formatBRL(claim.reimbursedAmount)}
          </p>
        )}
      </header>

      <div className="space-y-6">
        {/* 1 — reach the clinic. This is the first thing she actually does. */}
        <section className="space-y-2">
          <Label>Falar com o prestador</Label>
          {claim.phone ? (
            <div className="flex flex-wrap gap-2">
              <a href={`tel:${claim.phone}`} className={PILL_FILLED}>
                <Phone size={15} /> {claim.phone}
              </a>
              <a
                href={`https://wa.me/${waNumber(claim.phone)}`}
                target="_blank"
                rel="noreferrer"
                className={PILL_OUTLINED}
              >
                WhatsApp
              </a>
            </div>
          ) : (
            // An absence must look like a gap, not like nothing.
            <div className="space-y-2">
              <p className="text-ap-body-sm text-ash">Sem telefone cadastrado para este prestador.</p>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(
                  `${claim.providerName ?? ""} telefone`
                )}`}
                target="_blank"
                rel="noreferrer"
                className={PILL_OUTLINED}
              >
                <Search size={15} /> Procurar no Google
              </a>
            </div>
          )}
        </section>

        {/* 2 — the reason she opened the card. */}
        <section className="space-y-3 rounded-ap-card bg-ice p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-ap-caption font-semibold uppercase tracking-wide text-carbon">
              <ClipboardList size={13} /> O que pedir
            </p>
            <span className="rounded-ap-pill bg-white px-3 py-1 text-ap-caption font-semibold text-carbon">
              {OWNER_LABEL[claim.guidance.owner]}
            </span>
          </div>

          {claim.guidance.groupLabel && (
            <p className="text-ap-body-sm font-semibold text-carbon">{claim.guidance.groupLabel}</p>
          )}

          <ol className="space-y-3">
            {claim.guidance.ask.map((a, i) => (
              <li key={a} className="flex gap-3 text-ap-body text-carbon">
                <span className="shrink-0 font-semibold text-ash">{i + 1}.</span>
                <span>{a}</span>
              </li>
            ))}
          </ol>

          {claim.guidance.owner === "blocked" && (
            <p className="text-ap-body-sm text-ash">
              Aguarda resposta do corretor — não acionar o prestador ainda.
            </p>
          )}
        </section>

        {/* 3 — what gets the claim refused. */}
        {claim.guidance.warning && <Notice>{claim.guidance.warning}</Notice>}

        {blocking.length > 0 && (
          <Notice tone="error">
            <p className="font-semibold">Resolva antes de enviar</p>
            {blocking.map((g) => (
              <p key={g}>• {GAP_LABEL[g]}</p>
            ))}
          </Notice>
        )}

        <Attachments claimId={claim.id} onCountChange={countChanged} />

        <section className="space-y-3">
          <Label>Nota fiscal</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              className={PILL_OUTLINED}
            >
              <FileText size={15} /> Abrir PDF da nota
            </a>
          ) : (
            <Notice tone="error">Sem PDF guardado — peça a 2ª via ao prestador.</Notice>
          )}
        </section>

        <section className="space-y-3">
          <Label>Médico</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome" value={claim.doctorName} />
            <Field
              label="Registro"
              mono
              value={
                claim.council
                  ? `${claim.council.council} ${claim.council.number}${claim.council.uf ? `-${claim.council.uf}` : ""}`
                  : null
              }
            />
            <Field label="Especialidade" value={claim.specialty} />
            <Field label="Clínica" value={claim.clinic} />
          </div>
        </section>

        <section className="space-y-1.5">
          <Label>Paciente</Label>
          <p className="text-ap-body font-semibold text-carbon">
            {claim.patient ?? "não identificado"}
          </p>
          <p className="text-ap-body-sm text-ash">
            {PATIENT_SOURCE_LABEL[claim.patientSource]}
            {!claim.patientConfirmed && claim.patient && " — confirme antes de enviar"}
          </p>
          {hints.map((g) => (
            <p key={g} className="text-ap-body-sm text-ash">• {GAP_LABEL[g]}</p>
          ))}
        </section>

        {claim.serviceDescription && (
          <details className="group">
            <summary className="cursor-pointer list-none text-ap-body-sm font-semibold text-link-blue">
              Ver a descrição do serviço na nota
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-ap-body-sm leading-relaxed text-ash">
              {claim.serviceDescription}
            </p>
          </details>
        )}

        <details>
          <summary className="cursor-pointer list-none text-ap-body-sm font-semibold text-link-blue">
            O que o plano sempre exige
          </summary>
          <div className="mt-2 space-y-1.5">
            {REQUIRED_DOCUMENTS.map((d) => (
              <p key={d} className="flex gap-2 text-ap-body-sm text-ash">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {d}
              </p>
            ))}
          </div>
        </details>

        {next && (
          <section className="space-y-3 border-t border-hairline pt-6">
            {next.to === "submitted" && (
              <label className="block">
                <Label>Data do envio (vazio = hoje)</Label>
                <input
                  type="date"
                  value={sentDate}
                  onChange={(e) => setSentDate(e.target.value)}
                  className="mt-1.5 w-full rounded-ap-card border border-hairline bg-white px-3.5 py-3 text-ap-body text-carbon focus:border-apple-blue focus:outline-none"
                />
              </label>
            )}
            {next.to === "reimbursed" && (
              <label className="block">
                <Label>Valor reembolsado pelo plano (R$)</Label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="mt-1.5 w-full rounded-ap-card border border-hairline bg-white px-3.5 py-3 text-ap-body tabular-nums text-carbon focus:border-apple-blue focus:outline-none"
                />
              </label>
            )}

            {blocking.length > 0 && (
              <p className="text-ap-body-sm text-carbon">
                O plano recusa com as pendências acima em aberto.
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
              className={`${PILL_FILLED} w-full`}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              {next.label}
            </button>
          </section>
        )}

        {claim.state === "submitted" && claim.submittedAt && (
          <p className="flex items-center gap-1.5 text-ap-body-sm text-ash">
            <Send size={14} /> Enviado ao seguro em {fmt(claim.submittedAt)}
          </p>
        )}

        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── list

type FilterKey = "todas" | "sem_doc" | "com_doc" | "bloqueadas";

const FILTERS: { key: FilterKey; label: string; match: (c: Claim) => boolean }[] = [
  { key: "todas", label: "Todas", match: () => true },
  { key: "sem_doc", label: "Falta documento", match: (c) => c.attachmentCount === 0 },
  { key: "com_doc", label: "Já tem documento", match: (c) => (c.attachmentCount ?? 0) > 0 },
  { key: "bloqueadas", label: "Bloqueadas", match: isBlocked }
];

type Column = {
  key: SortKey;
  label: string;
  align?: "right" | "center";
  className?: string;
  adminOnly?: boolean;
};

const COLUMNS: Column[] = [
  { key: "provider", label: "Prestador" },
  { key: "patient", label: "Paciente", className: "hidden md:table-cell" },
  { key: "date", label: "Data", className: "hidden sm:table-cell" },
  { key: "amount", label: "Valor", align: "right" },
  { key: "docs", label: "Docs", align: "center" },
  { key: "state", label: "Situação", className: "hidden lg:table-cell" },
  { key: "owner", label: "Quem faz", className: "hidden lg:table-cell", adminOnly: true }
];

export function QueueClient({ role }: { role: Role }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("todas");
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/admin/health/queue");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setClaims(d.claims ?? []);
      setWarnings(d.warnings ?? []);
      setHidden(d.hiddenFromSecretary ?? 0);
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

  // Esc closes, and the page behind must not scroll while the card is open.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selectedId]);

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
      toast.success(`Marcado: ${STATE_LABEL[to]}`);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // An upload inside the card must move the counter on the row behind it.
  const setCount = useCallback((id: string, n: number) => {
    setClaims((cs) => cs.map((c) => (c.id === id ? { ...c, attachmentCount: n } : c)));
  }, []);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
      return;
    }
    setSortKey(key);
    setSortDir(defaultDir(key));
  }

  const columns = COLUMNS.filter((c) => !c.adminOnly || role !== "secretary");

  const filtered = useMemo(
    () => claims.filter(FILTERS.find((f) => f.key === filter)!.match),
    [claims, filter]
  );
  const sorted = useMemo(() => sortClaims(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  // Honest headline: what is actually claimable from APRIL. Rejected claims are
  // not receivable, and pre-25/02/2026 invoices belong to the previous insurer —
  // adding either to "a receber do plano" states a number that is not true.
  const totals = useMemo(() => {
    const april = claims.filter((c) => c.insurer !== "anterior" && c.state !== "rejected" && c.state !== "reimbursed");
    const previous = claims.filter((c) => c.insurer === "anterior" && c.state !== "reimbursed");
    const sum = (list: Claim[]) => list.reduce((s, c) => s + (c.amount ?? 0), 0);
    const known = claims.filter((c) => c.attachmentCount != null);
    return {
      aprilTotal: sum(april),
      aprilCount: april.length,
      previousTotal: sum(previous),
      previousCount: previous.length,
      withDocs: known.filter((c) => (c.attachmentCount ?? 0) > 0).length,
      knownCount: known.length
    };
  }, [claims]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-28 animate-pulse rounded-ap-card bg-pebble" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-ap-card bg-pebble" />
        ))}
        <p className="text-ap-body-sm text-ash">Carregando suas notas médicas...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`${CARD} space-y-3 p-6`}>
        <p className="text-ap-subheading font-semibold text-carbon">Não consegui carregar a fila</p>
        <p className="text-ap-body-sm text-ash">{loadError}</p>
        <button onClick={load} className={PILL_FILLED}>Tentar de novo</button>
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className={`${CARD} space-y-2 p-10 text-center`}>
        <p className="text-ap-subheading font-semibold text-carbon">Nenhuma nota médica na sua fila</p>
        <p className="text-ap-body-sm text-ash">
          Assim que uma nota médica for importada, ela aparece aqui.
        </p>
      </div>
    );
  }

  const pct = totals.knownCount ? Math.round((totals.withDocs / totals.knownCount) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Hero — three numbers, each with a noun attached. */}
      <section className={`${CARD} p-6`}>
        <Label>A pedir de reembolso à APRIL</Label>
        <p className="mt-1 text-ap-heading font-semibold tabular-nums text-carbon">
          {formatBRL(totals.aprilTotal)}
        </p>
        <p className="mt-1 text-ap-body font-light text-ash">
          {totals.aprilCount} {totals.aprilCount === 1 ? "nota" : "notas"} em aberto
        </p>

        <div className="mt-5">
          <div className="h-1.5 w-full overflow-hidden rounded-ap-pill bg-pebble">
            <div
              className="h-full rounded-ap-pill bg-apple-blue transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-ap-body-sm text-ash">
            {totals.withDocs} de {totals.knownCount} já com documento guardado
          </p>
        </div>

        {totals.previousCount > 0 && (
          <p className="mt-4 border-t border-hairline pt-4 text-ap-body-sm text-ash">
            Além dessas, {totals.previousCount} notas de {formatBRL(totals.previousTotal)} são
            anteriores a 25/02/2026 — pertencem ao {INSURER_LABEL.anterior}, não à APRIL.
          </p>
        )}
      </section>

      {warnings.length > 0 && (
        <Notice>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Notice>
      )}

      {hidden > 0 && (
        <p className="text-ap-body-sm text-ash">
          {hidden} nota(s) não aparecem aqui: são do Mickael ou aguardam o corretor.
        </p>
      )}

      {/* Filter pills — a thumb reaches these; a column header does not. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => {
          const n = claims.filter(f.match).length;
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-ap-pill px-4 py-2 text-ap-body-sm font-normal transition ${
                on
                  ? "bg-carbon text-white"
                  : "border border-hairline bg-white text-carbon hover:border-link-blue"
              }`}
            >
              {f.label} ({n})
            </button>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <div className={`${CARD} space-y-2 p-10 text-center`}>
          <p className="text-ap-subheading font-semibold text-carbon">Nada neste filtro</p>
          <p className="text-ap-body-sm text-ash">
            Nenhuma nota se encaixa em &quot;{FILTERS.find((f) => f.key === filter)!.label}&quot;.
          </p>
          <button onClick={() => setFilter("todas")} className={PILL_OUTLINED}>Ver todas</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-ap-card border border-hairline bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      sortKey === col.key ? (sortDir === 1 ? "ascending" : "descending") : "none"
                    }
                    className={`p-0 ${col.className ?? ""} ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    }`}
                  >
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex w-full items-center gap-1 px-4 py-3 text-ap-caption font-semibold uppercase tracking-wide transition hover:text-carbon ${
                        col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : ""
                      } ${sortKey === col.key ? "text-carbon" : "text-ash"}`}
                    >
                      {col.label}
                      {sortKey === col.key &&
                        (sortDir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelectedId(c.id); setActionError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(c.id);
                      setActionError(null);
                    }
                  }}
                  className="cursor-pointer border-b border-hairline last:border-0 transition-colors hover:bg-frost focus:bg-frost focus:outline-none"
                >
                  <td className="px-4 py-4">
                    <span className="text-ap-body-sm font-semibold text-carbon">
                      {c.providerName ?? "—"}
                    </span>
                    <span className="mt-0.5 block text-ap-caption text-ash md:hidden">
                      {c.patient ?? "paciente não identificado"}
                      <span className="sm:hidden"> · {fmt(c.emissionDate)}</span>
                    </span>
                    {(isBlocked(c) || c.insurer === "anterior") && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.gaps.filter((g) => BLOCKING.includes(g)).map((g) => (
                          <span
                            key={g}
                            className="rounded-ap-pill border border-hairline px-2 py-0.5 text-ap-caption text-carbon"
                          >
                            {g === "no_pdf" ? "Sem PDF" : "Paciente?"}
                          </span>
                        ))}
                        {c.insurer === "anterior" && (
                          <span className="rounded-ap-pill bg-pebble px-2 py-0.5 text-ap-caption text-carbon">
                            {INSURER_LABEL.anterior}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-4 text-ap-body-sm text-ash md:table-cell">
                    {c.patient ?? "—"}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-4 text-ap-body-sm tabular-nums text-ash sm:table-cell">
                    {fmt(c.emissionDate)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right text-ap-body-sm font-semibold tabular-nums text-carbon">
                    {c.amount != null ? formatBRL(c.amount) : "—"}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {c.attachmentCount == null ? (
                      <span className="text-ap-caption text-ash">?</span>
                    ) : c.attachmentCount === 0 ? (
                      <span className="text-ap-caption text-ash">nenhum</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-ap-body-sm font-semibold text-carbon">
                        <Paperclip size={13} /> {c.attachmentCount}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-4 lg:table-cell">
                    <span className="whitespace-nowrap rounded-ap-pill bg-pebble px-3 py-1 text-ap-caption font-semibold text-carbon">
                      {STATE_LABEL[c.state]}
                    </span>
                  </td>
                  {role !== "secretary" && (
                    <td className="hidden px-4 py-4 text-ap-body-sm text-ash lg:table-cell">
                      {OWNER_LABEL[c.guidance.owner]}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/40 p-0 sm:items-center sm:p-6"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-title"
            className="max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-5 sm:max-w-xl sm:rounded-ap-card"
          >
            <Detail
              claim={selected}
              onClose={() => setSelectedId(null)}
              onAdvance={advance}
              onCountChange={setCount}
              busy={busy}
              error={actionError}
            />
          </div>
        </div>
      )}
    </div>
  );
}
