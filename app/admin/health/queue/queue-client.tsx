"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Send, Loader2, AlertTriangle, FileText, X, Phone,
  ArrowRight, Wallet, Paperclip, ClipboardList, Upload, Camera,
  ChevronUp, ChevronDown, Search, RotateCcw, Square, CheckSquare, Trash2, CalendarClock
} from "lucide-react";
import { formatDate, formatBRL } from "@/lib/format";
import { STATE_LABEL, NEXT_ACTION, type ClaimState } from "@/lib/health/claim-status";
import { sortClaims, defaultDir, type SortKey } from "@/lib/health/claim-sort";
import { displayProvider } from "@/lib/health/provider-name";
import {
  GAP_LABEL, GAP_SHORT, PATIENT_SOURCE_LABEL, REQUIRED_DOCUMENTS, daysUntil,
  type ClaimGap, type PatientSource
} from "@/lib/health/claim-info";
import {
  OWNER_LABEL, INSURER_LABEL, type ClaimOwner, type Guidance, type Insurer
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
  whatsapp: string | null;
  providerAddress: string | null;
  contactPerson: string | null;
  contactConfidence: string | null;
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
  steps: { text: string; owner: ClaimOwner }[];
  stepsDone: number[];
  insurer: Insurer;
  deadline: string | null;
  attachmentCount: number | null;
};

/** Gaps that get the claim refused. The rest are hints, not blockers. */
const BLOCKING: ClaimGap[] = ["patient_unknown", "no_pdf"];
const blockingOf = (c: Claim) => c.gaps.filter((g) => BLOCKING.includes(g));

/** Short insurer chip. Both insurers are labelled — showing only one made the
 *  unlabelled rows look like they had no insurer at all. */
const INSURER_SHORT: Record<Insurer, string> = { april: "APRIL", anterior: "Bradesco" };

function fmt(d: string | null) {
  return d ? formatDate(d.slice(0, 10)) : "—";
}

/** Digits only, with the country code, for a wa.me link. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

// ─────────────────────────────────────────────────────── shared atoms

/** Apple has one filled colour and one outlined colour; everything
 *  interactive is a capsule and nothing carries a shadow. */
const PILL_FILLED =
  "inline-flex items-center justify-center gap-1.5 rounded-ap-pill bg-apple-blue px-4 py-2.5 " +
  "text-ap-body-sm font-normal text-white transition hover:opacity-90 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

const PILL_OUTLINED =
  "inline-flex items-center justify-center gap-1.5 rounded-ap-pill border border-link-blue px-4 py-2.5 " +
  "text-ap-body-sm font-normal text-link-blue transition hover:bg-link-blue/5 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

const CARD = "rounded-ap-card border border-hairline bg-white";
const CHIP = "rounded-ap-pill px-2 py-0.5 text-ap-caption whitespace-nowrap";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ap-caption font-semibold uppercase tracking-wide text-ash">{children}</p>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-ap-caption text-ash">{label}</p>
      <p className={`truncate text-ap-body-sm text-carbon ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}

/** Attention without colour-screaming: hairline box, carbon text, one icon. */
function Notice({ tone = "warn", children }: { tone?: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div className={`${CARD} flex gap-2 p-3`}>
      <AlertTriangle
        size={14}
        className={`mt-0.5 shrink-0 ${tone === "error" ? "text-error" : "text-carbon"}`}
      />
      <div className="text-ap-body-sm text-carbon">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── attachments

type Attachment = { name: string; size: number | null; uploadedAt: string | null; url: string };
type Pending = { file: File; name: string; error: string | null };

/**
 * The documents she collects. The first version gave no feedback at all: a
 * repeat upload re-rendered an identical list and she could not tell whether
 * anything saved — so pending, success and failure are all stated, and a
 * failure keeps the File so "try again" does not mean "find it on disk again".
 */
function Attachments({
  claimId,
  onCountChange
}: {
  claimId: string;
  onCountChange: (n: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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
      const r = await fetch(`/api/admin/health/queue/${claimId}/attachments`, { method: "POST", body });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setPending(null);
      setJustSaved(d.name);
      toast.success(
        d.renamed ? `Guardei como "${d.name}" — já existia um com esse nome` : `"${d.name}" guardado`
      );
      await load();
    } catch (e) {
      // Keep the File: retry must not send her back to the file picker.
      setPending((p) => (p ? { ...p, error: (e as Error).message } : p));
    }
  }, [claimId, load]);

  const remove = useCallback(async (name: string) => {
    setConfirmDelete(null);
    try {
      const r = await fetch(
        `/api/admin/health/queue/${claimId}/attachments/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `erro ${r.status}`);
      }
      toast.success(`"${name}" apagado`);
      await load();
    } catch (e) {
      toast.error(`Não consegui apagar: ${(e as Error).message}`);
    }
  }, [claimId, load]);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>Documentos guardados</Label>
        <span className="text-ap-caption text-ash">{loading ? "—" : files.length}</span>
      </div>

      {loading && <Loader2 size={14} className="animate-spin text-ash" />}

      {loadError && (
        <Notice tone="error">
          Não consegui ler os documentos: {loadError}
          <button onClick={load} className="ml-1 font-semibold text-link-blue underline">
            tentar de novo
          </button>
        </Notice>
      )}

      {!loading && !loadError && files.length === 0 && !pending && (
        <p className="text-ap-body-sm text-ash">
          Nada guardado ainda. Guarde aqui o laudo e o comprovante de pagamento.
        </p>
      )}

      {files.map((f) => (
        <div key={f.name} className={`${CARD} flex items-center gap-2 px-3 py-2`}>
          <FileText size={14} className="shrink-0 text-ash" />
          <a
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-ap-body-sm text-carbon hover:underline"
          >
            {f.name}
          </a>
          <span className="shrink-0 text-ap-caption tabular-nums text-ash">
            {f.size != null && `${(f.size / 1024).toFixed(0)} KB`}
          </span>
          {justSaved === f.name && (
            <CheckCircle2 size={14} className="shrink-0 text-link-blue" aria-label="guardado agora" />
          )}
          {/* Two steps, because there are no versions in the bucket: deleting a
              claim document destroys the evidence for good. */}
          {confirmDelete === f.name ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => remove(f.name)}
                className="text-ap-caption font-semibold text-error underline"
              >
                apagar
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="text-ap-caption text-ash underline"
              >
                cancelar
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(f.name)}
              aria-label={`Apagar ${f.name}`}
              className="shrink-0 rounded-ap-pill p-1 text-mist transition hover:text-error"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}

      {pending && (
        <div className={`${CARD} px-3 py-2`}>
          {pending.error ? (
            <>
              <p className="text-ap-body-sm text-carbon">
                Não consegui guardar &quot;{pending.name}&quot; — {pending.error}
              </p>
              <button
                onClick={() => upload(pending.file)}
                className="mt-1 inline-flex items-center gap-1 text-ap-body-sm font-semibold text-link-blue underline"
              >
                <RotateCcw size={12} /> Tentar de novo
              </button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-ap-body-sm text-ash">
              <Loader2 size={14} className="animate-spin" />
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
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => picker.current?.click()}
          disabled={!!pending && !pending.error}
          className={PILL_OUTLINED}
        >
          <Upload size={14} /> Guardar documento
        </button>
        <button
          onClick={() => camera.current?.click()}
          disabled={!!pending && !pending.error}
          className={`${PILL_OUTLINED} sm:hidden`}
        >
          <Camera size={14} /> Tirar foto
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────── detail card

function Detail({
  claim, onClose, onAdvance, onCountChange, onToggleStep, busy, error
}: {
  claim: Claim;
  onClose: () => void;
  onAdvance: (to: ClaimState, extra: { amount?: number; submittedAt?: string }) => void;
  onCountChange: (id: string, n: number) => void;
  onToggleStep: (id: string, index: number, done: boolean) => void;
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
  const blocking = blockingOf(claim);
  const hints = claim.gaps.filter((g) => !BLOCKING.includes(g));
  const hasDoctor = Boolean(claim.doctorName || claim.council);

  return (
    // Header is a flex sibling of the scroll area, not a sticky child of it:
    // sticky inside a padded scroller let the content show through above the
    // header as it scrolled past.
    <div className="flex max-h-[92vh] flex-col">
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="claim-title" className="truncate text-ap-body font-semibold text-carbon">
              {displayProvider(claim.providerName)}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span className="text-ap-subheading font-semibold tabular-nums text-carbon">
                {claim.amount != null ? formatBRL(claim.amount) : "—"}
              </span>
              <span className="text-ap-caption text-ash">
                NF {claim.nfNumber ?? "—"} · {fmt(claim.emissionDate)}
              </span>
              {claim.deadline && (() => {
                // Six months is enough time to chase a hospital report; less
                // than that and the row needs to look different from the rest.
                const left = daysUntil(claim.deadline, new Date().toISOString().slice(0, 10));
                const tight = left != null && left < 180;
                return (
                  <span
                    className={`inline-flex items-center gap-1 text-ap-caption ${
                      tight ? "font-semibold text-carbon" : "text-ash"
                    }`}
                    title="Dois anos a partir do atendimento (Condições Gerais da apólice)"
                  >
                    <CalendarClock size={12} />
                    prazo {fmt(claim.deadline)}
                    {tight && (left! > 0 ? ` — faltam ${left} dias` : " — VENCIDO")}
                  </span>
                );
              })()}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 shrink-0 rounded-ap-pill p-2 text-ash transition hover:bg-frost"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP} bg-pebble font-semibold text-carbon`}>
            {STATE_LABEL[claim.state]}
          </span>
          <span
            className={`${CHIP} font-semibold ${
              claim.insurer === "april"
                ? "bg-apple-blue text-white"
                : "border border-hairline text-carbon"
            }`}
          >
            {INSURER_LABEL[claim.insurer]}
          </span>
          {claim.patient && <span className={`${CHIP} text-ash`}>{claim.patient}</span>}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {claim.insurer === "anterior" && (
          <Notice>Atendimento anterior a 25/02/2026 — não enviar à APRIL.</Notice>
        )}

        {/* The reason she opened the card. */}
        <section className="space-y-2 rounded-ap-card bg-ice p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-ap-caption font-semibold uppercase tracking-wide text-carbon">
              <ClipboardList size={12} /> O que pedir
            </p>
            <span className={`${CHIP} bg-white font-semibold text-carbon`}>
              {OWNER_LABEL[claim.guidance.owner]}
            </span>
          </div>
          {claim.guidance.groupLabel && (
            <p className="text-ap-body-sm font-semibold text-carbon">{claim.guidance.groupLabel}</p>
          )}
          {/* One checkbox per step, saved on the spot. Five requests down one
              phone call is exactly where an interrupted call used to mean
              starting the card again tomorrow. The list numbers itself — the
              manual "1." that used to sit here made every copy read "1. 1.". */}
          <ul className="space-y-2">
            {claim.steps.map((step, i) => {
              const done = claim.stepsDone.includes(i);
              return (
                <li key={step.text} className="text-ap-body-sm">
                  <button
                    onClick={() => onToggleStep(claim.id, i, !done)}
                    className="flex w-full items-start gap-2 text-left"
                    aria-pressed={done}
                  >
                    {done ? (
                      <CheckSquare size={15} className="mt-0.5 shrink-0 text-apple-blue" />
                    ) : (
                      <Square size={15} className="mt-0.5 shrink-0 text-mist" />
                    )}
                    <span className={done ? "text-ash line-through" : "text-carbon"}>
                      {step.text}
                      {/* Only flag the steps that are NOT this card's owner:
                          marking every step would be noise. */}
                      {step.owner !== claim.guidance.owner && (
                        <span className={`${CHIP} ml-1.5 bg-pebble align-middle text-carbon`}>
                          {OWNER_LABEL[step.owner]}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {claim.guidance.owner === "blocked" && (
            <p className="text-ap-caption text-ash">
              Aguarda o corretor — não acionar o prestador ainda.
            </p>
          )}
        </section>

        {claim.guidance.warning && <Notice>{claim.guidance.warning}</Notice>}

        {blocking.length > 0 && (
          <Notice tone="error">
            <span className="font-semibold">Resolva antes de enviar: </span>
            {blocking.map((g) => GAP_LABEL[g]).join(" · ")}
          </Notice>
        )}

        {/* Contact + invoice side by side: two short blocks instead of two
            screens of scrolling. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="space-y-2">
            <Label>Falar com o prestador</Label>
            {claim.phone ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  <a href={`tel:${claim.phone}`} className={PILL_FILLED}>
                    <Phone size={14} /> {claim.phone}
                  </a>
                  <a
                    href={`https://wa.me/${waNumber(claim.whatsapp ?? claim.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className={PILL_OUTLINED}
                  >
                    WhatsApp
                  </a>
                </div>
                {claim.providerAddress && (
                  <p className="text-ap-caption text-ash">{claim.providerAddress}</p>
                )}
                {/* Never present a web-search result as a verified number. */}
                {claim.contactConfidence !== "confirmed" && (
                  <p className="text-ap-caption text-ash">
                    Contato encontrado em busca pública, ainda não confirmado por ligação.
                  </p>
                )}
                {claim.contactPerson && (
                  <p className="text-ap-caption text-ash">
                    Responsável no prestador: {claim.contactPerson}
                  </p>
                )}
              </div>
            ) : (
              // An absence must look like a gap, not like nothing.
              <div className="space-y-1.5">
                <p className="text-ap-body-sm text-ash">Sem telefone cadastrado.</p>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(
                    `${claim.providerName ?? ""} telefone`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className={PILL_OUTLINED}
                >
                  <Search size={14} /> Procurar no Google
                </a>
              </div>
            )}
            {hasDoctor ? (
              <p className="text-ap-body-sm text-carbon">
                {claim.doctorName ?? "—"}
                {claim.council && (
                  <span className="text-ash">
                    {" "}· {claim.council.council} {claim.council.number}
                    {claim.council.uf ? `-${claim.council.uf}` : ""}
                  </span>
                )}
                {claim.specialty && <span className="text-ash"> · {claim.specialty}</span>}
              </p>
            ) : (
              <p className="text-ap-body-sm text-ash">
                A nota não nomeia o médico — peça nome e CRM no laudo.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <Label>Nota fiscal</Label>
            <div className="grid grid-cols-2 gap-2">
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
                <FileText size={14} /> Abrir PDF da nota
              </a>
            ) : (
              <p className="text-ap-body-sm text-carbon">
                Sem PDF guardado — peça a 2ª via ao prestador.
              </p>
            )}
            <p className="text-ap-caption text-ash">
              Paciente: {claim.patient ?? "não identificado"} — {PATIENT_SOURCE_LABEL[claim.patientSource]}
            </p>
            {hints.map((g) => (
              <p key={g} className="text-ap-caption text-ash">• {GAP_LABEL[g]}</p>
            ))}
          </section>
        </div>

        <Attachments claimId={claim.id} onCountChange={countChanged} />

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {claim.serviceDescription && (
            <details>
              <summary className="cursor-pointer list-none text-ap-caption font-semibold text-link-blue">
                Descrição do serviço na nota
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-ap-caption leading-relaxed text-ash">
                {claim.serviceDescription}
              </p>
            </details>
          )}
          <details>
            <summary className="cursor-pointer list-none text-ap-caption font-semibold text-link-blue">
              O que o plano sempre exige
            </summary>
            <div className="mt-1 space-y-1">
              {REQUIRED_DOCUMENTS.map((d) => (
                <p key={d} className="text-ap-caption text-ash">• {d}</p>
              ))}
            </div>
          </details>
        </div>

        {claim.state === "reimbursed" && claim.reimbursedAmount != null && (
          <p className="flex items-center gap-1.5 text-ap-body-sm text-carbon">
            <Wallet size={14} /> Reembolsado {formatBRL(claim.reimbursedAmount)}
          </p>
        )}
        {claim.state === "submitted" && claim.submittedAt && (
          <p className="flex items-center gap-1.5 text-ap-body-sm text-ash">
            <Send size={14} /> Enviado ao seguro em {fmt(claim.submittedAt)}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {next && (
        <footer className="shrink-0 space-y-2 border-t border-hairline px-4 py-3">
          {next.to === "submitted" && (
            <input
              type="date"
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
              aria-label="Data do envio (vazio = hoje)"
              className="w-full rounded-ap-card border border-hairline bg-white px-3 py-2 text-ap-body-sm text-carbon focus:border-apple-blue focus:outline-none"
            />
          )}
          {next.to === "reimbursed" && (
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Valor reembolsado (R$)"
              aria-label="Valor reembolsado pelo plano"
              className="w-full rounded-ap-card border border-hairline bg-white px-3 py-2 text-ap-body-sm tabular-nums text-carbon focus:border-apple-blue focus:outline-none"
            />
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
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {next.label}
          </button>
        </footer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── list

type FilterKey = "todas" | "sem_doc" | "com_doc" | "bloqueadas";

const FILTERS: { key: FilterKey; label: string; match: (c: Claim) => boolean }[] = [
  { key: "todas", label: "Todas", match: () => true },
  { key: "sem_doc", label: "Falta documento", match: (c) => c.attachmentCount === 0 },
  { key: "com_doc", label: "Já tem documento", match: (c) => (c.attachmentCount ?? 0) > 0 },
  { key: "bloqueadas", label: "Bloqueadas", match: (c) => blockingOf(c).length > 0 }
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
  { key: "patient", label: "Paciente", className: "hidden lg:table-cell" },
  { key: "date", label: "Data", className: "hidden sm:table-cell" },
  { key: "insurer", label: "Seguro", className: "hidden md:table-cell" },
  { key: "gap", label: "Pendência", className: "hidden md:table-cell" },
  { key: "amount", label: "Valor", align: "right" },
  { key: "docs", label: "Docs", align: "center" },
  { key: "state", label: "Situação", className: "hidden xl:table-cell" },
  { key: "owner", label: "Quem faz", className: "hidden xl:table-cell", adminOnly: true }
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

  // Ticking a step is optimistic: she taps, it strikes through immediately,
  // and a server refusal puts it back with the reason. Waiting for a round trip
  // on a checkbox is how a list stops being usable during a phone call.
  const toggleStep = useCallback(async (id: string, index: number, done: boolean) => {
    setClaims((cs) =>
      cs.map((c) =>
        c.id === id
          ? {
              ...c,
              stepsDone: done
                ? [...c.stepsDone, index]
                : c.stepsDone.filter((i) => i !== index)
            }
          : c
      )
    );
    try {
      const r = await fetch(`/api/admin/health/queue/${id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, done })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `erro ${r.status}`);
      }
    } catch (e) {
      toast.error(`Não consegui marcar: ${(e as Error).message}`);
      setClaims((cs) =>
        cs.map((c) =>
          c.id === id
            ? {
                ...c,
                stepsDone: done
                  ? c.stepsDone.filter((i) => i !== index)
                  : [...c.stepsDone, index]
              }
            : c
        )
      );
    }
  }, []);

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

  // A column whose every cell says the same thing carries no information and
  // costs width. 23 identical "A enviar" chips told her nothing actionable.
  const showState = new Set(claims.map((c) => c.state)).size > 1;
  const columns = COLUMNS.filter(
    (c) => (!c.adminOnly || role !== "secretary") && (c.key !== "state" || showState)
  );

  const filtered = useMemo(
    () => claims.filter(FILTERS.find((f) => f.key === filter)!.match),
    [claims, filter]
  );
  const sorted = useMemo(
    () => sortClaims(filtered.map((c) => ({ ...c, blockingGaps: blockingOf(c) })), sortKey, sortDir),
    [filtered, sortKey, sortDir]
  );

  // Honest headline: what is actually claimable from APRIL. Rejected claims are
  // not receivable, and pre-25/02/2026 invoices belong to the previous insurer —
  // adding either would state a number that is not true.
  const totals = useMemo(() => {
    const april = claims.filter(
      (c) => c.insurer !== "anterior" && c.state !== "rejected" && c.state !== "reimbursed"
    );
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
        <div className="h-24 animate-pulse rounded-ap-card bg-pebble" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-ap-card bg-pebble" />
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
    <div className="space-y-5">
      {/* Hero — three numbers, each with a noun attached. */}
      <section className={`${CARD} p-5`}>
        <Label>A pedir de reembolso à APRIL</Label>
        <p className="mt-1 text-ap-heading font-semibold tabular-nums text-carbon">
          {formatBRL(totals.aprilTotal)}
        </p>
        <p className="mt-0.5 text-ap-body font-light text-ash">
          {totals.aprilCount} {totals.aprilCount === 1 ? "nota" : "notas"} em aberto
        </p>
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-ap-pill bg-pebble">
            <div className="h-full rounded-ap-pill bg-apple-blue transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-ap-body-sm text-ash">
            {totals.withDocs} de {totals.knownCount} já com documento guardado
          </p>
        </div>
        {totals.previousCount > 0 && (
          <p className="mt-3 border-t border-hairline pt-3 text-ap-body-sm text-ash">
            Além dessas, {totals.previousCount} notas de {formatBRL(totals.previousTotal)} são
            anteriores a 25/02/2026 — pertencem ao {INSURER_LABEL.anterior}, não à APRIL.
          </p>
        )}
      </section>

      {warnings.length > 0 && (
        <Notice>{warnings.map((w) => <p key={w}>{w}</p>)}</Notice>
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
              className={`shrink-0 rounded-ap-pill px-4 py-2 text-ap-body-sm transition ${
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

      {/* Sorting must survive the phone, where the sortable header is hidden. */}
      <div className="flex items-center gap-2 sm:hidden">
        <label htmlFor="ordenar" className="text-ap-caption text-ash">Ordenar por</label>
        <select
          id="ordenar"
          value={sortKey}
          onChange={(e) => {
            const k = e.target.value as SortKey;
            setSortKey(k);
            setSortDir(defaultDir(k));
          }}
          className="rounded-ap-pill border border-hairline bg-white px-3 py-2 text-ap-body-sm text-carbon"
        >
          {columns.map((col) => (
            <option key={col.key} value={col.key}>{col.label}</option>
          ))}
        </select>
        <button
          onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
          aria-label="Inverter a ordem"
          className="rounded-ap-pill border border-hairline bg-white px-3 py-2 text-carbon"
        >
          {sortDir === 1 ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
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
          <table className="w-full max-sm:block">
            {/* Sorting by column header needs a header; on a phone the header is
                hidden, so the select above carries it. */}
            <thead className="max-sm:hidden">
              <tr className="border-b border-hairline">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sortKey === col.key ? (sortDir === 1 ? "ascending" : "descending") : "none"}
                    className={`p-0 ${col.className ?? ""} ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    }`}
                  >
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex w-full items-center gap-1 px-3 py-2.5 text-ap-caption font-semibold uppercase tracking-wide transition hover:text-carbon ${
                        col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : ""
                      } ${sortKey === col.key ? "text-carbon" : "text-ash"}`}
                    >
                      {col.label}
                      {sortKey === col.key && (sortDir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {sorted.map((c) => {
                const blocking = blockingOf(c);
                return (
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
                    className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-frost focus:bg-frost focus:outline-none max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:px-4 max-sm:py-3"
                  >
                    <td className="px-3 py-3 max-sm:col-start-1 max-sm:row-span-2 max-sm:p-0">
                      <span className="text-ap-body-sm font-semibold text-carbon">
                        {displayProvider(c.providerName)}
                      </span>
                      <span className="mt-0.5 block text-ap-caption text-ash lg:hidden">
                        {c.patient ?? "paciente não identificado"}
                        <span className="sm:hidden"> · {fmt(c.emissionDate)}</span>
                      </span>
                      {/* On a phone the Seguro and Pendência columns are hidden,
                          so the same facts ride along under the name. */}
                      <span className="mt-1 flex flex-wrap gap-1 md:hidden">
                        <span
                          className={`${CHIP} ${
                            c.insurer === "april" ? "bg-apple-blue text-white" : "bg-pebble text-carbon"
                          }`}
                        >
                          {INSURER_SHORT[c.insurer]}
                        </span>
                        {blocking.map((g) => (
                          <span key={g} className={`${CHIP} border border-hairline text-carbon`}>
                            {GAP_SHORT[g]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-ap-body-sm text-ash lg:table-cell">
                      {c.patient ?? "—"}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-ap-body-sm tabular-nums text-ash sm:table-cell">
                      {fmt(c.emissionDate)}
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <span
                        className={`${CHIP} font-semibold ${
                          c.insurer === "april" ? "bg-apple-blue text-white" : "bg-pebble text-carbon"
                        }`}
                      >
                        {INSURER_SHORT[c.insurer]}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 text-ap-body-sm md:table-cell">
                      {blocking.length > 0 ? (
                        <span className="text-carbon">{blocking.map((g) => GAP_SHORT[g]).join(" · ")}</span>
                      ) : (
                        <span className="text-mist">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ap-body-sm font-semibold tabular-nums text-carbon max-sm:col-start-2 max-sm:row-start-1 max-sm:p-0">
                      {c.amount != null ? formatBRL(c.amount) : "—"}
                    </td>
                    <td className="px-3 py-3 text-center max-sm:col-start-2 max-sm:row-start-2 max-sm:p-0 max-sm:text-right">
                      {c.attachmentCount == null ? (
                        // Unknown is not zero — "none" would send her to
                        // re-collect paperwork she may already have.
                        <span className="text-ap-caption text-ash" title="não consegui contar">?</span>
                      ) : c.attachmentCount === 0 ? (
                        <span className="text-ap-caption text-mist">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ap-body-sm font-semibold text-carbon">
                          <Paperclip size={12} /> {c.attachmentCount}
                        </span>
                      )}
                    </td>
                    {showState && (
                      <td className="hidden px-3 py-3 xl:table-cell">
                        <span className={`${CHIP} bg-pebble font-semibold text-carbon`}>
                          {STATE_LABEL[c.state]}
                        </span>
                      </td>
                    )}
                    {role !== "secretary" && (
                      <td className="hidden px-3 py-3 text-ap-body-sm text-ash xl:table-cell">
                        {OWNER_LABEL[c.guidance.owner]}
                      </td>
                    )}
                  </tr>
                );
              })}
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
            className="w-full rounded-t-2xl bg-white sm:max-w-2xl sm:rounded-ap-card"
          >
            <Detail
              claim={selected}
              onClose={() => setSelectedId(null)}
              onAdvance={advance}
              onCountChange={setCount}
              onToggleStep={toggleStep}
              busy={busy}
              error={actionError}
            />
          </div>
        </div>
      )}
    </div>
  );
}
