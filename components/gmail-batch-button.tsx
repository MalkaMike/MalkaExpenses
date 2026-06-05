"use client";
import { useState, useEffect, useRef } from "react";
import { Loader2, RefreshCw, Pause, Play, Sparkles } from "lucide-react";
import { formatInt } from "@/lib/format";

type Status = {
  totalExpenses: number;
  searched: number;
  withMatches: number;
  pending: number;
  pctSearched: number;
  pctHitRate: number;
};

// Drives the batch-find loop from the client.
// Calls /batch-find repeatedly until done, showing live progress.
export function GmailBatchButton() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Ref-based stop flag so the loop sees the latest value (state would be stale in closure)
  const stopRef = useRef(false);

  async function loadStatus() {
    try {
      const r = await fetch("/api/admin/gmail/batch-status");
      if (!r.ok) throw new Error(await r.text());
      setStatus(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function runOneBatch(): Promise<{ done: boolean; remaining: number; found: number; processed: number }> {
    const r = await fetch("/api/admin/gmail/batch-find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 30 })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? `Erro ${r.status}`);
    }
    return await r.json();
  }

  async function start() {
    stopRef.current = false;
    setRunning(true);
    setErr(null);
    try {
      while (!stopRef.current) {
        const result = await runOneBatch();
        await loadStatus();
        if (result.done) break;
        await new Promise((res) => setTimeout(res, 250));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    stopRef.current = true;
  }

  const pct = status?.pctSearched ?? 0;
  const isDone = status && status.pending === 0 && status.totalExpenses > 0;

  return (
    <div className="rounded-xl bg-surface-container-lowest border border-outline-variant p-4 soft-ambient-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/5 flex items-center justify-center">
            <Sparkles size={16} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm text-on-surface">Buscar notas fiscais em lote</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {status
                ? isDone
                  ? `${formatInt(status.withMatches)} encontradas de ${formatInt(status.searched)} buscadas`
                  : `${formatInt(status.searched)}/${formatInt(status.totalExpenses)} despesas processadas`
                : "carregando…"}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={loadStatus}
            disabled={running}
            title="Atualizar status"
            className="p-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40"
          >
            <RefreshCw size={13} />
          </button>
          {running ? (
            <button
              onClick={stop}
              className="px-3 py-1.5 rounded-lg bg-error/10 text-error border border-error/30 text-xs font-medium flex items-center gap-1.5 hover:bg-error/15 transition"
            >
              <Pause size={12} /> Pausar
            </button>
          ) : (
            <button
              onClick={start}
              disabled={isDone === true}
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-medium flex items-center gap-1.5 hover:opacity-80 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={12} /> {isDone ? "Concluído" : status && status.searched > 0 ? "Continuar" : "Iniciar"}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {status && status.totalExpenses > 0 && (
        <>
          <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isDone ? "bg-secondary" : "bg-primary"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-on-surface-variant tabular-nums">
              {pct}% buscado
            </span>
            {status.searched > 0 && (
              <span className="text-[10px] text-on-surface-variant tabular-nums">
                Taxa de acerto: {status.pctHitRate}% · {formatInt(status.withMatches)} com nota fiscal
              </span>
            )}
          </div>
        </>
      )}

      {/* Active processing indicator */}
      {running && (
        <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">
          <Loader2 size={12} className="animate-spin text-primary" />
          <span>Processando lote… {status && `${formatInt(status.pending)} restantes`}</span>
        </div>
      )}

      {err && (
        <div className="mt-3 p-2.5 rounded-lg bg-error-container/30 border border-error/20 text-xs text-on-error-container">
          {err}
        </div>
      )}
    </div>
  );
}
