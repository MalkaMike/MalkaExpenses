"use client";

import { useState } from "react";
import { Send, CheckCircle2, FileWarning } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { displayProvider } from "@/lib/health/provider-name";
import { INSURER_LABEL } from "@/lib/health/claim-guidance";
import type { BradescoBatch, BatchClaim } from "@/lib/health/bradesco-batch";
import { CARD, PILL_FILLED, PILL_OUTLINED, Label, Notice, fmt } from "./ui";

type Result = {
  sentCount: number;
  skippedCount: number;
  skipped: { nfNumber: string | null; reason: string }[];
};

/**
 * Celina's second job, whole, in one card.
 *
 * The previous insurer asks for nothing but the invoice, so there is no doctor
 * to phone and no report to wait for — one send covers the lot. Kept visibly
 * separate from the APRIL list because mixing "make a phone call" with "press
 * send" is what had her chasing reports nobody had asked for.
 */
export function BradescoCard({
  batch,
  onSent,
}: {
  batch: BradescoBatch<BatchClaim>;
  onSent: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // No old invoices at all: the job does not exist, so neither should the card.
  if (batch.all.length === 0) return null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/health/queue/bradesco-batch", {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setResult({
        sentCount: d.sentCount,
        skippedCount: d.skippedCount,
        skipped: d.skipped ?? [],
      });
      setConfirming(false);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sendable = batch.pending.filter((c) => c.hasPdf).length;

  return (
    <section className={`${CARD} space-y-4 p-5`}>
      <div>
        <Label>2 · Enviar notas ao {INSURER_LABEL.anterior}</Label>
        <p className="mt-1 text-ap-body-sm font-light text-ash">
          Estas são de antes de 25/02/2026. O {INSURER_LABEL.anterior} não pede
          laudo nem relatório — basta enviar a nota. Não precisa ligar para
          nenhum médico aqui.
        </p>
        {/* Written as the steps she actually performs, in order. One batch beats
            21 separate sends, and nobody has confirmed yet which channel the old
            insurer accepts — so the first step is to ask them, not to guess. */}
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ap-body-sm text-carbon">
          <li>
            Abra cada nota em &quot;Abrir nota&quot; e salve todas numa pasta no
            computador.
          </li>
          <li>
            Ligue para o {INSURER_LABEL.anterior} e confirme se dá para enviar
            por e-mail, e para qual endereço.
          </li>
          <li>Envie todas de uma vez só, num envio único — não uma por uma.</li>
          <li>Só depois de enviar, marque como enviadas no botão abaixo.</li>
        </ol>
      </div>

      {batch.done ? (
        <p className="flex items-center gap-2 text-ap-body-sm text-carbon">
          <CheckCircle2 size={15} className="text-apple-blue" />
          Todas as {batch.all.length} notas já foram enviadas —{" "}
          {formatBRL(batch.sentTotal)}.
        </p>
      ) : (
        <>
          <div>
            <p className="text-ap-heading font-semibold tabular-nums text-carbon">
              {formatBRL(batch.pendingTotal)}
            </p>
            <p className="mt-0.5 text-ap-body font-light text-ash">
              {batch.pending.length}{" "}
              {batch.pending.length === 1 ? "nota a enviar" : "notas a enviar"}
              {batch.sent.length > 0 && ` · ${batch.sent.length} já enviada(s)`}
            </p>
          </div>

          <ul className="divide-y divide-hairline overflow-hidden rounded-ap-card border border-hairline">
            {batch.pending.map((c) => (
              <li key={c.id} className="flex items-baseline gap-3 px-3 py-2.5">
                <span className="w-20 shrink-0 text-ap-caption tabular-nums text-ash">
                  {fmt(c.emissionDate)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ap-body-sm text-carbon">
                    {displayProvider(c.providerName)}
                  </span>
                  {c.patient && (
                    <span className="text-ap-caption text-ash">
                      {" "}
                      · {c.patient}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-ap-body-sm tabular-nums text-carbon">
                  {formatBRL(c.amount ?? 0)}
                </span>
                {/* Her job here is to SEND these notas, so she has to be able to
                    open each one. The first version listed them with no way to
                    reach the document at all — she found the list, could not find
                    the invoice, and was blocked on her first morning. Same route
                    and same behaviour as the provider page. */}
                {c.hasPdf ? (
                  <a
                    href={`/api/admin/nota-fiscais/${c.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-ap-caption font-semibold text-link-blue underline"
                  >
                    Abrir nota
                  </a>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-ap-caption text-ash">
                    <FileWarning size={11} /> sem PDF
                  </span>
                )}
              </li>
            ))}
          </ul>

          {batch.awaitingBroker.length > 0 && (
            <Notice>
              {batch.awaitingBroker.length} nota(s) são de prestador que ainda
              depende de resposta do corretor —{" "}
              {[
                ...new Set(
                  batch.awaitingBroker.map((c) =>
                    displayProvider(c.providerName),
                  ),
                ),
              ].join(", ")}
              . Elas entram no envio junto com as outras. Se preferir segurar
              essas, fale com o Mickael antes de confirmar.
            </Notice>
          )}

          {batch.missingPdf.length > 0 && (
            <Notice>
              {batch.missingPdf.length} nota(s) não têm o PDF guardado, então
              não há o que enviar. Elas ficam de fora e continuam na lista até o
              PDF entrar.
            </Notice>
          )}

          {/* A bulk write on a money trail: one deliberate confirmation, so a
              mis-click cannot record 14 invoices as sent. */}
          {confirming ? (
            <div className="space-y-2">
              <p className="text-ap-body-sm text-carbon">
                Confirmar que {sendable} nota(s) foram enviadas ao{" "}
                {INSURER_LABEL.anterior}?
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={send} disabled={busy} className={PILL_FILLED}>
                  {busy ? "Registrando..." : "Sim, registrar como enviadas"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className={PILL_OUTLINED}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={sendable === 0}
              className={PILL_FILLED}
            >
              <Send size={14} /> Marcar {sendable} nota(s) como enviadas
            </button>
          )}
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {result && (
        <div className="space-y-1 text-ap-body-sm text-carbon">
          <p>{result.sentCount} nota(s) registradas como enviadas.</p>
          {result.skippedCount > 0 && (
            <>
              <p className="text-ash">{result.skippedCount} ficaram de fora:</p>
              <ul className="list-disc pl-5 text-ap-caption text-ash">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    NF {s.nfNumber ?? "sem número"} — {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
