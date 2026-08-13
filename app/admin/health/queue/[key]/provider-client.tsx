"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, Search, Square, CheckSquare, FileText, Upload, Camera,
  Trash2, RotateCcw, Loader2, CheckCircle2, CalendarClock
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import { displayProvider } from "@/lib/health/provider-name";
import { groupByProvider, type GroupableClaim } from "@/lib/health/provider-group";
import { INSURER_LABEL, OWNER_LABEL, type ClaimOwner } from "@/lib/health/claim-guidance";
import { GAP_LABEL, PATIENT_SOURCE_LABEL, daysUntil, type ClaimGap } from "@/lib/health/claim-info";
import type { Role } from "@/lib/auth/admin";
import { CARD, CHIP, PILL_FILLED, PILL_OUTLINED, Label, Notice, Bar, fmt, waNumber } from "../ui";

/** The claim fields this page shows on top of what grouping needs. */
type Claim = GroupableClaim & {
  phone: string | null;
  whatsapp: string | null;
  providerAddress: string | null;
  contactPerson: string | null;
  contactConfidence: string | null;
  patientSource: keyof typeof PATIENT_SOURCE_LABEL;
  doctorName: string | null;
  council: { council: string; number: string; uf: string | null } | null;
  specialty: string | null;
};

type Attachment = { name: string; size: number | null; uploadedAt: string | null; url: string };
type Pending = { file: File; name: string; error: string | null };

/**
 * One provider, one page. Everything she needs for one phone call, and nothing
 * else: who to call, what to ask, which visits it covers, where the paper goes.
 *
 * A full page rather than a dialog on purpose — in a 1000×800 window the dialog
 * scrolled inside a page that also scrolled, and she landed in the middle of it.
 */
export function ProviderClient({ providerKey, role }: { providerKey: string; role: Role }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [stepsDone, setStepsDone] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/admin/health/queue");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setClaims(d.claims ?? []);
      setStepsDone((d.stepsDoneByKey ?? {})[providerKey] ?? []);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [providerKey]);

  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/health/providers/${providerKey}/attachments`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setAttachments(d.attachments ?? []);
    } catch (e) {
      // null means "could not read", which must never render as "none".
      setAttachments(null);
      toast.error(`Não consegui ler os documentos: ${(e as Error).message}`);
    }
  }, [providerKey]);

  useEffect(() => { loadClaims(); loadFiles(); }, [loadClaims, loadFiles]);

  const group = useMemo(() => {
    const all = groupByProvider(claims, new Map([[providerKey, stepsDone]]));
    return all.find((g) => g.key === providerKey) ?? null;
  }, [claims, providerKey, stepsDone]);

  // Contact details are the same on every invoice of the provider.
  const contact = group?.claims[0] as Claim | undefined;

  const toggleStep = useCallback(async (index: number, done: boolean) => {
    // Optimistic: waiting on a round trip for a checkbox is how a list stops
    // being usable in the middle of a phone call.
    setStepsDone((s) => (done ? [...s, index] : s.filter((i) => i !== index)));
    try {
      const r = await fetch(`/api/admin/health/providers/${providerKey}/steps`, {
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
      setStepsDone((s) => (done ? s.filter((i) => i !== index) : [...s, index]));
    }
  }, [providerKey]);

  const upload = useCallback(async (file: File) => {
    setPending({ file, name: file.name, error: null });
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await fetch(`/api/admin/health/providers/${providerKey}/attachments`, {
        method: "POST",
        body
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setPending(null);
      toast.success(
        d.renamed ? `Guardei como "${d.name}" — já existia um com esse nome` : `"${d.name}" guardado`
      );
      await loadFiles();
    } catch (e) {
      // Keep the File: retry must not send her back to the file picker.
      setPending((p) => (p ? { ...p, error: (e as Error).message } : p));
    }
  }, [providerKey, loadFiles]);

  const remove = useCallback(async (name: string) => {
    setConfirmDelete(null);
    try {
      const r = await fetch(
        `/api/admin/health/providers/${providerKey}/attachments/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `erro ${r.status}`);
      }
      toast.success(`"${name}" apagado`);
      await loadFiles();
    } catch (e) {
      toast.error(`Não consegui apagar: ${(e as Error).message}`);
    }
  }, [providerKey, loadFiles]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-ap-card bg-pebble" />
        <div className="h-40 animate-pulse rounded-ap-card bg-pebble" />
        <p className="text-ap-body-sm text-ash">Carregando...</p>
      </div>
    );
  }

  if (loadError || !group || !contact) {
    return (
      <div className={`${CARD} space-y-3 p-6`}>
        <p className="text-ap-subheading font-semibold text-carbon">
          {loadError ? "Não consegui carregar" : "Prestador não encontrado"}
        </p>
        {loadError && <p className="text-ap-body-sm text-ash">{loadError}</p>}
        <Link href="/admin/health/queue" className={PILL_OUTLINED}>
          <ArrowLeft size={14} /> Voltar à lista
        </Link>
      </div>
    );
  }

  const mine = group.stepsForOwner(role === "secretary" ? "secretary" : group.guidance.owner);
  const left = daysUntil(group.deadline, new Date().toISOString().slice(0, 10));
  const phone = contact.phone;

  return (
    <div className="space-y-5">
      <Link
        href="/admin/health/queue"
        className="inline-flex items-center gap-1.5 text-ap-body-sm text-link-blue"
      >
        <ArrowLeft size={15} /> Todos os prestadores
      </Link>

      {/* 1 — who to call. */}
      <section className={`${CARD} space-y-3 p-5`}>
        <div>
          <h1 className="text-ap-subheading font-semibold text-carbon">
            {displayProvider(group.providerName)}
          </h1>
          <p className="mt-0.5 text-ap-body-sm text-ash">
            {group.claims.length} {group.claims.length === 1 ? "nota" : "notas"} ·{" "}
            {formatBRL(group.total)}
            {group.patients.length > 0 && ` · ${group.patients.join(", ")}`}
          </p>
          {group.deadline && (
            <p
              className={`mt-1 inline-flex items-center gap-1 text-ap-caption ${
                left != null && left < 180 ? "font-semibold text-carbon" : "text-ash"
              }`}
            >
              <CalendarClock size={12} /> prazo {fmt(group.deadline)}
              {left != null && left < 180 && (left > 0 ? ` — faltam ${left} dias` : " — VENCIDO")}
            </p>
          )}
        </div>

        {phone ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <a href={`tel:${phone}`} className={PILL_FILLED}>
                <Phone size={14} /> {phone}
              </a>
              <a
                href={`https://wa.me/${waNumber(contact.whatsapp ?? phone)}`}
                target="_blank"
                rel="noreferrer"
                className={PILL_OUTLINED}
              >
                WhatsApp
              </a>
            </div>
            {contact.providerAddress && (
              <p className="text-ap-caption text-ash">{contact.providerAddress}</p>
            )}
            {contact.contactConfidence !== "confirmed" && (
              // Never present a web-search result as a verified number.
              <p className="text-ap-caption text-ash">
                Contato de busca pública, ainda não confirmado por ligação.
              </p>
            )}
            {contact.contactPerson && (
              <p className="text-ap-caption text-ash">Responsável: {contact.contactPerson}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-ap-body-sm text-ash">Sem telefone cadastrado.</p>
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(
                `${group.providerName} telefone`
              )}`}
              target="_blank"
              rel="noreferrer"
              className={PILL_OUTLINED}
            >
              <Search size={14} /> Procurar no Google
            </a>
          </div>
        )}
      </section>

      {/* 2 — what to ask. */}
      <section className={`${CARD} space-y-3 p-5`}>
        <div className="flex items-baseline justify-between gap-2">
          <Label>O que pedir</Label>
          <span className="text-ap-caption text-ash">
            {mine.done} de {mine.total}
          </span>
        </div>
        {group.guidance.groupLabel && (
          <p className="text-ap-body-sm font-semibold text-carbon">{group.guidance.groupLabel}</p>
        )}
        <Bar done={mine.done} total={mine.total} />
        <ul className="space-y-2 pt-1">
          {group.steps.map((step, i) => {
            const done = stepsDone.includes(i);
            return (
              <li key={step.text}>
                <button
                  onClick={() => toggleStep(i, !done)}
                  aria-pressed={done}
                  className="flex w-full items-start gap-2 text-left text-ap-body-sm"
                >
                  {done ? (
                    <CheckSquare size={16} className="mt-0.5 shrink-0 text-apple-blue" />
                  ) : (
                    <Square size={16} className="mt-0.5 shrink-0 text-mist" />
                  )}
                  <span className={done ? "text-ash line-through" : "text-carbon"}>
                    {step.text}
                    {step.owner !== group.guidance.owner && (
                      <span className={`${CHIP} ml-1.5 bg-pebble align-middle text-carbon`}>
                        {OWNER_LABEL[step.owner as ClaimOwner]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {group.guidance.warning && <Notice>{group.guidance.warning}</Notice>}
        {group.blocking.length > 0 && (
          <Notice tone="error">
            <span className="font-semibold">Resolva antes de enviar: </span>
            {group.blocking.map((g: ClaimGap) => GAP_LABEL[g]).join(" · ")}
          </Notice>
        )}
      </section>

      {/* 3 — the visits this call covers. Split by insurer: one call, but the
             paperwork goes to two different places. */}
      {([
        ["APRIL", group.april, group.aprilTotal],
        [INSURER_LABEL.anterior, group.previous, group.previousTotal]
      ] as const)
        .filter(([, list]) => list.length > 0)
        .map(([title, list, sum]) => (
          <section key={title} className={`${CARD} overflow-hidden`}>
            <div className="flex items-baseline justify-between border-b border-hairline px-4 py-3">
              <p className="text-ap-body-sm font-semibold text-carbon">
                {title} · {list.length} {list.length === 1 ? "nota" : "notas"}
              </p>
              <p className="text-ap-body-sm font-semibold tabular-nums text-carbon">
                {formatBRL(sum)}
              </p>
            </div>
            {list.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-ap-body-sm text-carbon">
                    {fmt(c.emissionDate)}
                    <span className="text-ash"> · {c.patient ?? "paciente não identificado"}</span>
                  </p>
                  {!c.patientConfirmed && c.patient && (
                    <p className="text-ap-caption text-ash">confirmar o paciente antes de enviar</p>
                  )}
                </div>
                <p className="shrink-0 text-ap-body-sm font-semibold tabular-nums text-carbon">
                  {formatBRL(c.amount ?? 0)}
                </p>
                {c.hasPdf ? (
                  <a
                    href={`/api/admin/nota-fiscais/${c.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-ap-caption font-semibold text-link-blue underline"
                  >
                    PDF
                  </a>
                ) : (
                  <span className="shrink-0 text-ap-caption text-ash">sem PDF</span>
                )}
              </div>
            ))}
          </section>
        ))}

      {/* 4 — where the paper lands. One place for the whole provider. */}
      <section className={`${CARD} space-y-2 p-5`}>
        <div className="flex items-baseline justify-between">
          <Label>Documentos guardados</Label>
          <span className="text-ap-caption text-ash">
            {attachments === null ? "?" : attachments.length}
          </span>
        </div>
        <p className="text-ap-body-sm text-ash">
          O laudo vale para todas as notas deste prestador. O Mickael envia tudo junto ao seguro.
        </p>

        {attachments === null && (
          <Notice tone="error">
            Não consegui ler os documentos.
            <button onClick={loadFiles} className="ml-1 font-semibold text-link-blue underline">
              tentar de novo
            </button>
          </Notice>
        )}

        {attachments?.length === 0 && !pending && (
          <p className="text-ap-body-sm text-ash">Nada guardado ainda.</p>
        )}

        {attachments?.map((f) => (
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
            {/* Two steps, because the bucket keeps no versions: deleting a claim
                document destroys the evidence for good. */}
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
        <div className="flex flex-wrap gap-2 pt-1">
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

        {group.done && (
          <p className="flex items-center gap-1.5 pt-2 text-ap-body-sm text-carbon">
            <CheckCircle2 size={15} className="text-apple-blue" />
            Tudo pedido e documento guardado — este prestador está pronto.
          </p>
        )}
      </section>
    </div>
  );
}
