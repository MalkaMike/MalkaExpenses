"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, Search, X, Plus, ChevronRight } from "lucide-react";
import { safeJson } from "@/lib/http";

type ClusterOption = { key: string; name: string };

type Props = {
  /** Original bank description (e.g. "PIX CLAUDIA STELZER") */
  descriptionRaw: string;
  /** Display name of the current merchant */
  currentName: string;
  /** All other clusters available as move targets (excludes current) */
  allClusters: ClusterOption[];
};

// ↗ button on each transaction row. Opens a popover to reassign this
// specific bank description (and all rows sharing it) to another merchant —
// either an existing one or a new name.
export function MoveDescriptionButton({ descriptionRaw, currentName, allClusters }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const suggestions = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return allClusters.slice(0, 12);
    return allClusters
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 15);
  })();

  const hasExactMatch = suggestions.some(
    (c) => c.name.toLowerCase() === query.trim().toLowerCase()
  );

  async function moveToExisting(target: ClusterOption) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/merchants/move-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "move-to-existing",
          description_raw: descriptionRaw,
          target_canonical_key: target.key
        })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setDone(`${j.transactions_affected} transação(ões) movida(s) para "${target.name}"`);
      router.refresh();
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function moveToNew() {
    const newName = query.trim();
    if (!newName) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/merchants/move-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "move-to-new",
          description_raw: descriptionRaw,
          new_canonical_name: newName
        })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setDone(`${j.transactions_affected} transação(ões) movida(s) para novo merchant "${newName}"`);
      router.refresh();
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setErr(null); setDone(null); setQuery(""); }}
        title={`Não é ${currentName} — mover para outro merchant`}
        className="shrink-0 w-8 h-8 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 flex items-center justify-center transition"
      >
        <ArrowRightLeft size={13} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2.5 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Mover para outro merchant
              </p>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-surface-container-high rounded text-on-surface-variant">
                <X size={12} />
              </button>
            </div>

            {/* Original description */}
            <div className="px-4 py-3 border-b border-outline-variant bg-surface-container/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                Descrição original do banco
              </p>
              <p className="text-xs text-on-surface font-mono break-all">{descriptionRaw}</p>
              <p className="text-[10px] text-on-surface-variant mt-1">
                Atualmente em: <span className="font-medium text-on-surface">{currentName}</span>
              </p>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-outline-variant">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar merchant ou criar novo…"
                  disabled={busy}
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-surface-container border border-outline-variant text-sm outline-none focus:border-primary transition text-on-surface"
                />
              </div>
              {query.trim() && !hasExactMatch && (
                <button
                  onClick={moveToNew}
                  disabled={busy}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs flex items-center justify-center gap-1.5 hover:bg-primary/10 transition text-primary font-medium disabled:opacity-40"
                >
                  <Plus size={11} /> Criar novo: &ldquo;{query.trim()}&rdquo;
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto">
              {busy && (
                <div className="p-4 text-center">
                  <Loader2 size={16} className="animate-spin mx-auto text-on-surface-variant" />
                  <p className="text-xs text-on-surface-variant mt-1.5">Movendo…</p>
                </div>
              )}
              {!busy && suggestions.length > 0 && (
                <ul className="divide-y divide-outline-variant">
                  {suggestions.map((c) => (
                    <li key={c.key}>
                      <button
                        onClick={() => moveToExisting(c)}
                        disabled={busy}
                        className="w-full px-3 py-2.5 text-left text-sm text-on-surface hover:bg-surface-container transition flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{c.name}</span>
                        <ChevronRight size={12} className="text-on-surface-variant shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!busy && suggestions.length === 0 && !query.trim() && (
                <p className="px-3 py-4 text-center text-xs text-on-surface-variant">
                  Nenhum merchant encontrado
                </p>
              )}
            </div>

            {/* Status */}
            {err && (
              <div className="p-3 bg-error-container/30 border-t border-outline-variant">
                <p className="text-xs text-on-error-container">{err}</p>
              </div>
            )}
            {done && (
              <div className="p-3 bg-secondary-container/40 border-t border-outline-variant">
                <p className="text-xs text-on-secondary-container">{done}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
