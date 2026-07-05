"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, X } from "lucide-react";

type BatchResult = { processed: number; remaining: number; done: boolean };

// Runs /api/admin/merchants/research-bulk repeatedly (each call handles a
// bounded batch server-side to stay under Vercel's timeout) until every
// not-yet-reviewed merchant has a cached deep-research verdict.
export function BulkResearchButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Ref, not state — the running loop reads this on every iteration, and a
  // plain state variable would be captured stale in the async closure.
  const stopRequested = useRef(false);

  async function run() {
    setRunning(true);
    stopRequested.current = false;
    setErr(null);
    setProcessed(0);
    setRemaining(null);
    try {
      let done = false;
      while (!done) {
        if (stopRequested.current) break;
        const r = await fetch("/api/admin/merchants/research-bulk", { method: "POST" });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Erro ${r.status}`);
        }
        const j = (await r.json()) as BatchResult;
        setProcessed((p) => p + j.processed);
        setRemaining(j.remaining);
        done = j.done || j.processed === 0;
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mb-4 p-3 rounded-xl border border-outline-variant bg-surface-container-lowest flex items-center gap-3">
      {!running ? (
        <button
          onClick={run}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition"
        >
          <Search size={12} /> Pesquisar todos os comerciantes não revisados
        </button>
      ) : (
        <>
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
          <span className="text-xs text-on-surface-variant">
            Pesquisando… {processed} processados{remaining !== null ? `, ${remaining} restantes` : ""}
          </span>
          <button
            onClick={() => { stopRequested.current = true; }}
            className="ml-auto text-[10px] px-2 py-1 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface transition flex items-center gap-1"
          >
            <X size={10} /> Parar
          </button>
        </>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
