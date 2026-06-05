"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, GitMerge, X, RefreshCw, ChevronRight, Sparkles } from "lucide-react";
import { formatInt } from "@/lib/format";

type Suggestion = {
  cluster_a: { key: string; name: string; txCount: number };
  cluster_b: { key: string; name: string; txCount: number };
  similarity: number;
  shared_tokens: string[];
};

type Response = {
  suggestions: Suggestion[];
  totalFound: number;
  scanned: number;
};

export function SuggestionsClient() {
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/merchants/suggest-merges");
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Merge B INTO A — A survives with its name, B's descriptions move to A
  async function mergeBIntoA(suggestion: Suggestion) {
    const pairId = `${suggestion.cluster_a.key}::${suggestion.cluster_b.key}`;
    setBusyKey(pairId);
    try {
      const r = await fetch("/api/admin/merchants/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_canonical_key: suggestion.cluster_b.key,
          target_canonical_key: suggestion.cluster_a.key
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      // Remove this suggestion + any other suggestion involving cluster B
      setData((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.filter(
                (s) =>
                  s.cluster_a.key !== suggestion.cluster_b.key &&
                  s.cluster_b.key !== suggestion.cluster_b.key
              )
            }
          : null
      );
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  function dismiss(suggestion: Suggestion) {
    const id = `${suggestion.cluster_a.key}::${suggestion.cluster_b.key}`;
    setDismissed((prev) => new Set(prev).add(id));
  }

  const visible = data?.suggestions.filter(
    (s) => !dismissed.has(`${s.cluster_a.key}::${s.cluster_b.key}`)
  ) ?? [];

  return (
    <>
      {/* Stats header */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Merchants escaneados</p>
          <p className="text-2xl font-semibold text-on-surface tabular-nums">{data ? formatInt(data.scanned) : "—"}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Duplicatas prováveis</p>
          <p className="text-2xl font-semibold text-[#f59e0b] tabular-nums">{data ? formatInt(data.totalFound) : "—"}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow hover:bg-surface-container transition disabled:opacity-40 text-left"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
            Atualizar
          </p>
          <p className="text-sm font-semibold text-on-surface inline-flex items-center gap-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-escanear
          </p>
        </button>
      </div>

      {/* Loading / Error / Empty states */}
      {loading && !data && (
        <div className="p-12 text-center rounded-xl bg-surface-container-lowest border border-outline-variant">
          <Loader2 size={24} className="animate-spin mx-auto text-on-surface-variant" />
          <p className="text-sm text-on-surface-variant mt-3">Escaneando merchants…</p>
        </div>
      )}
      {err && (
        <div className="p-4 rounded-xl bg-error-container/30 border border-error/20">
          <p className="text-sm text-on-error-container">{err}</p>
        </div>
      )}
      {!loading && data && visible.length === 0 && (
        <div className="p-12 text-center rounded-xl bg-secondary-container/20 border border-secondary-container">
          <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center mx-auto mb-3">
            <Sparkles size={22} className="text-secondary" />
          </div>
          <p className="font-semibold text-on-surface">Nenhuma duplicata encontrada</p>
          <p className="text-sm text-on-surface-variant mt-1">
            {dismissed.size > 0 && `${formatInt(dismissed.size)} sugestões ignoradas nesta sessão.`}
          </p>
        </div>
      )}

      {/* Suggestions list */}
      {visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((s) => {
            const pairId = `${s.cluster_a.key}::${s.cluster_b.key}`;
            const busy = busyKey === pairId;
            return (
              <li key={pairId} className="rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow overflow-hidden">
                {/* Top row — similarity + shared tokens */}
                <div className="px-4 py-2 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        s.similarity >= 0.8
                          ? "bg-secondary text-on-secondary"
                          : s.similarity >= 0.6
                            ? "bg-secondary-container text-on-secondary-container"
                            : "bg-[#f59e0b]/15 text-[#f59e0b]"
                      }`}
                    >
                      {(s.similarity * 100).toFixed(0)}% similar
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {s.shared_tokens.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                          {t}
                        </span>
                      ))}
                      {s.shared_tokens.length > 4 && (
                        <span className="text-[10px] text-on-surface-variant">+{s.shared_tokens.length - 4}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => dismiss(s)}
                    title="Ignorar esta sugestão"
                    className="p-1.5 rounded hover:bg-surface-container-highest text-on-surface-variant"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Body — two merchants side by side */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
                  {/* Cluster A (survives) */}
                  <Link
                    href={`/admin/merchants/${encodeURIComponent(s.cluster_a.key)}?direction=out`}
                    className="p-4 hover:bg-surface-container transition group"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider text-secondary mb-1">
                      Fica com este nome
                    </p>
                    <p className="font-semibold text-on-surface text-sm line-clamp-2">{s.cluster_a.name}</p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {formatInt(s.cluster_a.txCount)} descrição{s.cluster_a.txCount !== 1 ? "ões" : ""}
                    </p>
                  </Link>

                  {/* Arrow + merge button */}
                  <div className="flex flex-col items-center justify-center px-3 py-2 border-l border-r border-outline-variant bg-surface-container/30">
                    <button
                      onClick={() => mergeBIntoA(s)}
                      disabled={busy}
                      title={`Fundir "${s.cluster_b.name}" em "${s.cluster_a.name}"`}
                      className="px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:opacity-80 transition disabled:opacity-40 active:scale-95"
                    >
                      {busy
                        ? <><Loader2 size={12} className="animate-spin" /> Fundindo…</>
                        : <><GitMerge size={12} /> Fundir →</>
                      }
                    </button>
                  </div>

                  {/* Cluster B (will be absorbed) */}
                  <Link
                    href={`/admin/merchants/${encodeURIComponent(s.cluster_b.key)}?direction=out`}
                    className="p-4 hover:bg-surface-container transition text-right"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider text-error mb-1">
                      Vai sumir
                    </p>
                    <p className="font-semibold text-on-surface text-sm line-clamp-2">{s.cluster_b.name}</p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {formatInt(s.cluster_b.txCount)} descrição{s.cluster_b.txCount !== 1 ? "ões" : ""}
                    </p>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
