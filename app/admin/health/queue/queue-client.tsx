"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Paperclip, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { displayProvider } from "@/lib/health/provider-name";
import { groupByProvider, type GroupableClaim } from "@/lib/health/provider-group";
import { INSURER_LABEL } from "@/lib/health/claim-guidance";
import { daysUntil } from "@/lib/health/claim-info";
import type { Role } from "@/lib/auth/admin";
import { CARD, CHIP, PILL_FILLED, Bar, Label, Notice, fmt } from "./ui";

/**
 * The work list, one row per PROVIDER.
 *
 * It used to be one row per invoice: 23 rows for 12 providers, so making one
 * phone call meant opening six near-identical cards. One call gets one report
 * covering all of that provider's visits, so the provider is the unit.
 */
export function QueueClient({ role }: { role: Role }) {
  const [claims, setClaims] = useState<GroupableClaim[]>([]);
  const [stepsDoneByKey, setStepsDone] = useState<Record<string, number[]>>({});
  const [attachmentsByKey, setAttachments] = useState<Record<string, number> | null>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/admin/health/queue");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      // A response served from an old service-worker cache predates per-provider
      // guidance, so every claim is missing `steps`/`guidance`. Rendering it
      // throws deep inside groupByProvider and blanks the screen with no way
      // out. Catch the shape here and say what to do instead.
      const list: GroupableClaim[] = d.claims ?? [];
      if (list.some((c) => !c.guidance || !c.steps)) {
        throw new Error(
          "Esta tela veio de uma versão antiga guardada no navegador. " +
            "Recarregue com Ctrl+Shift+R para buscar a versão nova."
        );
      }
      setClaims(list);
      setStepsDone(d.stepsDoneByKey ?? {});
      setAttachments(d.attachmentsByKey ?? null);
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

  const groups = useMemo(
    () =>
      groupByProvider(
        claims,
        new Map(Object.entries(stepsDoneByKey)),
        attachmentsByKey ? new Map(Object.entries(attachmentsByKey)) : null
      ),
    [claims, stepsDoneByKey, attachmentsByKey]
  );

  const totals = useMemo(() => {
    const april = groups.reduce((s, g) => s + g.aprilTotal, 0);
    const previous = groups.reduce((s, g) => s + g.previousTotal, 0);
    const openProviders = groups.filter((g) => !g.done).length;
    return { april, previous, openProviders };
  }, [groups]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-ap-card bg-pebble" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-ap-card bg-pebble" />
        ))}
        <p className="text-ap-body-sm text-ash">Carregando os prestadores...</p>
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

  if (groups.length === 0) {
    return (
      <div className={`${CARD} space-y-2 p-10 text-center`}>
        <p className="text-ap-subheading font-semibold text-carbon">Nada na sua fila</p>
        <p className="text-ap-body-sm text-ash">
          Assim que uma nota médica for importada, o prestador aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className={`${CARD} p-5`}>
        <Label>A pedir de reembolso à APRIL</Label>
        <p className="mt-1 text-ap-heading font-semibold tabular-nums text-carbon">
          {formatBRL(totals.april)}
        </p>
        <p className="mt-0.5 text-ap-body font-light text-ash">
          {totals.openProviders}{" "}
          {totals.openProviders === 1 ? "prestador para acionar" : "prestadores para acionar"}
        </p>
        {totals.previous > 0 && (
          <p className="mt-3 border-t border-hairline pt-3 text-ap-body-sm text-ash">
            Mais {formatBRL(totals.previous)} em notas anteriores a 25/02/2026 — são do{" "}
            {INSURER_LABEL.anterior}, não da APRIL.
          </p>
        )}
      </section>

      {warnings.length > 0 && <Notice>{warnings.map((w) => <p key={w}>{w}</p>)}</Notice>}

      {hidden > 0 && (
        <p className="text-ap-body-sm text-ash">
          {hidden} nota(s) não aparecem aqui: são do Mickael ou aguardam o corretor.
        </p>
      )}

      <div className="overflow-hidden rounded-ap-card border border-hairline bg-white">
        {groups.map((g) => {
          // Her own progress, not diluted by the steps that are Mickael's.
          const mine = g.stepsForOwner(role === "secretary" ? "secretary" : g.guidance.owner);
          const left = daysUntil(g.deadline, new Date().toISOString().slice(0, 10));
          return (
            <Link
              key={g.key}
              href={`/admin/health/queue/${g.key}`}
              className="flex items-center gap-4 border-b border-hairline px-4 py-4 transition last:border-0 hover:bg-frost focus-visible:bg-frost focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={`text-ap-body-sm font-semibold ${g.done ? "text-ash" : "text-carbon"}`}
                  >
                    {displayProvider(g.providerName)}
                  </span>
                  {g.done && <CheckCircle2 size={14} className="text-apple-blue" />}
                  {g.april.length > 0 && (
                    <span className={`${CHIP} bg-apple-blue font-semibold text-white`}>
                      APRIL {g.april.length}
                    </span>
                  )}
                  {g.previous.length > 0 && (
                    <span className={`${CHIP} bg-pebble text-carbon`}>
                      Bradesco {g.previous.length}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-ap-caption text-ash">
                  {g.claims.length} {g.claims.length === 1 ? "nota" : "notas"} ·{" "}
                  {formatBRL(g.total)}
                  {g.patients.length > 0 && ` · ${g.patients.join(", ")}`}
                </p>
                <div className="mt-2 max-w-xs">
                  <Bar done={mine.done} total={mine.total} />
                  <p className="mt-1 text-ap-caption text-ash">
                    {mine.done} de {mine.total}{" "}
                    {mine.total === 1 ? "pedido feito" : "pedidos feitos"}
                    {g.attachmentCount != null && g.attachmentCount > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-carbon">
                        <Paperclip size={11} /> {g.attachmentCount}
                      </span>
                    )}
                    {/* Six months is enough time to chase a report; less than
                        that and the row has to look different. */}
                    {left != null && left < 180 && (
                      <span className="ml-2 font-semibold text-carbon">
                        {left > 0 ? `prazo em ${left} dias` : "PRAZO VENCIDO"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-mist" />
            </Link>
          );
        })}
      </div>

      <p className="text-ap-caption text-ash">
        Prazo de {fmt(groups.map((g) => g.deadline).filter(Boolean).sort()[0])} é o mais próximo de
        todos. Dois anos a partir do atendimento.
      </p>
    </div>
  );
}
