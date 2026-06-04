"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2, Pencil, X } from "lucide-react";
import { formatBRL, formatDate, formatInt } from "@/lib/format";

type Row = {
  id: string;
  date: string;
  description: string;
  descriptionRaw: string;
  amount: number;
  sharedAmount: number;
  accountName: string;
  categoryName: string;
  source: string;
  aiReasoning: string | null;
};
type Category = { id: string; slug: string; name: string };

type Props = {
  canonicalKey: string;
  currentCategoryId: string | null;
  categories: Category[];
  rows: Row[];
  currentShareMode: "hide" | "show" | "mixed";
  currentSharedTotal: number;
  currentName: string;
};

export function MerchantDetailClient({
  canonicalKey,
  currentCategoryId,
  categories,
  rows,
  currentShareMode,
  currentSharedTotal,
  currentName
}: Props) {
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState<string>(currentCategoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<"hide" | "show" | "set" | null>(null);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [shareDone, setShareDone] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentName);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  // Per-row pending state (which tx is currently being toggled)
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Optimistic local override of sharedAmount per row id
  const [localShared, setLocalShared] = useState<Record<string, number>>({});

  async function applyToAll() {
    if (!selectedCat) return;
    setBusy(true);
    setErr(null);
    setDoneCount(null);
    try {
      const r = await fetch("/api/admin/merchants/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_key: canonicalKey,
          category_id: selectedCat
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setDoneCount(j.updated ?? 0);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyShare(mode: "hide" | "show" | "set", value?: number) {
    setShareBusy(mode);
    setShareErr(null);
    setShareDone(null);
    try {
      const r = await fetch("/api/admin/merchants/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_key: canonicalKey,
          mode,
          ...(value !== undefined ? { value } : {})
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setShareDone(
        mode === "hide"
          ? `${formatInt(j.updated)} ${j.updated === 1 ? "transação escondida" : "transações escondidas"} do portal`
          : mode === "show"
            ? `${formatInt(j.updated)} ${j.updated === 1 ? "transação mostrada" : "transações mostradas"} no portal`
            : `${formatInt(j.updated)} ${j.updated === 1 ? "transação ajustada para" : "transações ajustadas para"} ${formatBRL(value ?? 0)}`
      );
      setLocalShared({});
      if (mode === "set") {
        setAdjustOpen(false);
        setAdjustValue("");
      }
      router.refresh();
    } catch (e) {
      setShareErr((e as Error).message);
    } finally {
      setShareBusy(null);
    }
  }

  async function applyAdjust() {
    const v = parseFloat(adjustValue.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v)) {
      setShareErr("Valor inválido");
      return;
    }
    await applyShare("set", v);
  }

  async function applyRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentName) {
      setEditingName(false);
      return;
    }
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const r = await fetch("/api/admin/merchants/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: canonicalKey, name: trimmed })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      setEditingName(false);
      router.refresh();
    } catch (e) {
      setRenameErr((e as Error).message);
    } finally {
      setRenameBusy(false);
    }
  }

  async function toggleRowHide(row: Row) {
    const effectiveShared = localShared[row.id] ?? row.sharedAmount;
    const willHide = effectiveShared !== 0;
    setRowBusy(row.id);
    // Optimistic update
    setLocalShared((prev) => ({
      ...prev,
      [row.id]: willHide ? 0 : row.amount
    }));
    try {
      const r = await fetch(`/api/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hide: willHide })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      // Don't refresh whole page — keep the local optimistic state until next
      // navigation. Otherwise scrolling jumps and the user loses position.
    } catch (e) {
      // Revert optimistic update on failure
      setLocalShared((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      alert((e as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      {/* Rename row (display name only — doesn't change clustering) */}
      <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
        <p className="text-xs uppercase tracking-wider text-muted mb-2">
          Nome exibido
        </p>
        {!editingName ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-base font-medium truncate">{currentName}</p>
            <button
              onClick={() => {
                setNameDraft(currentName);
                setRenameErr(null);
                setEditingName(true);
              }}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-fg hover:border-fg/30 transition flex items-center gap-1.5"
              title="Renomear (só muda o nome exibido, não afeta agrupamento)"
            >
              <Pencil size={12} /> Renomear
            </button>
          </div>
        ) : (
          <div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={120}
                className="flex-1 px-3 py-2 rounded-xl bg-bg border border-border text-sm outline-none focus:border-accent transition"
              />
              <button
                onClick={applyRename}
                disabled={renameBusy || !nameDraft.trim()}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5
                  ${renameBusy || !nameDraft.trim()
                    ? "bg-fg/20 text-fg/40 cursor-not-allowed"
                    : "bg-fg text-bg hover:bg-fg/90"}`}
              >
                {renameBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Salvar
              </button>
              <button
                onClick={() => setEditingName(false)}
                disabled={renameBusy}
                className="px-2 py-2 rounded-xl border border-border text-muted hover:text-fg transition"
                aria-label="Cancelar"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[10px] text-muted mt-2">
              Só muda o nome exibido — não afeta agrupamento. Próximos lançamentos da Pluggy
              com a mesma descrição vão usar este nome automaticamente.
            </p>
            {renameErr && <p className="text-xs text-danger mt-1.5">{renameErr}</p>}
          </div>
        )}
      </section>

      {/* Categorize-all action */}
      <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
        <p className="text-xs uppercase tracking-wider text-muted mb-2">
          Aplicar categoria a TODAS as {formatInt(rows.length)} transações
        </p>
        <div className="flex gap-2">
          <select
            value={selectedCat}
            onChange={(e) => setSelectedCat(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl bg-bg border border-border text-sm outline-none focus:border-accent transition"
          >
            <option value="">Escolha uma categoria…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={applyToAll}
            disabled={busy || !selectedCat}
            className={`px-4 py-2.5 rounded-xl font-medium text-sm transition flex items-center gap-2
              ${busy || !selectedCat
                ? "bg-fg/20 text-fg/40 cursor-not-allowed"
                : "bg-fg text-bg hover:bg-fg/90 active:scale-[0.99]"}`}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Aplicando…
              </>
            ) : (
              <>
                <Check size={14} /> Aplicar
              </>
            )}
          </button>
        </div>
        {doneCount !== null && (
          <p className="mt-2 text-xs text-accent">
            ✅ {formatInt(doneCount)} {doneCount === 1 ? "transação atualizada" : "transações atualizadas"}
          </p>
        )}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </section>

      {/* Compartilhar com Ayelet (dual ledger control at cluster level) */}
      <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-muted">
            Compartilhar com Ayelet
          </p>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              currentShareMode === "hide"
                ? "bg-warning/15 text-warning"
                : currentShareMode === "show"
                  ? "bg-accent/10 text-accent"
                  : "bg-fg/10 text-muted"
            }`}
          >
            {currentShareMode === "hide"
              ? "ESCONDIDO"
              : currentShareMode === "show"
                ? "MOSTRANDO"
                : "MISTO"}
          </span>
        </div>
        <p className="text-xs text-muted mb-3">
          Atual no portal compartilhado: <span className="tabular-nums font-medium text-fg">{formatBRL(currentSharedTotal)}</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => applyShare("hide")}
            disabled={shareBusy !== null || currentShareMode === "hide"}
            className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition flex items-center justify-center gap-2
              ${shareBusy !== null || currentShareMode === "hide"
                ? "border-border text-fg/40 cursor-not-allowed"
                : "border-warning/40 text-warning hover:bg-warning/5 active:scale-[0.99]"}`}
          >
            {shareBusy === "hide" ? (
              <><Loader2 size={14} className="animate-spin" /> ...</>
            ) : (
              <><EyeOff size={14} /> Esconder</>
            )}
          </button>
          <button
            onClick={() => applyShare("show")}
            disabled={shareBusy !== null || currentShareMode === "show"}
            className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition flex items-center justify-center gap-2
              ${shareBusy !== null || currentShareMode === "show"
                ? "border-border text-fg/40 cursor-not-allowed"
                : "border-accent/40 text-accent hover:bg-accent/5 active:scale-[0.99]"}`}
          >
            {shareBusy === "show" ? (
              <><Loader2 size={14} className="animate-spin" /> ...</>
            ) : (
              <><Eye size={14} /> Valor real</>
            )}
          </button>
          <button
            onClick={() => { setAdjustOpen(true); setShareErr(null); }}
            disabled={shareBusy !== null}
            className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition flex items-center justify-center gap-2
              ${shareBusy !== null
                ? "border-border text-fg/40 cursor-not-allowed"
                : "border-border text-muted hover:text-fg hover:border-fg/30 active:scale-[0.99]"}`}
          >
            <Pencil size={14} /> Ajustar
          </button>
        </div>

        {adjustOpen && (
          <div className="mt-3 p-3 rounded-xl bg-bg/40 border border-border">
            <p className="text-xs text-muted mb-2">
              Define o mesmo valor compartilhado para TODAS as {formatInt(rows.length)} transações (positivo = receita, negativo = despesa).
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                inputMode="decimal"
                placeholder="ex: 5000,00 ou -250,00"
                value={adjustValue}
                onChange={(e) => setAdjustValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyAdjust();
                  if (e.key === "Escape") { setAdjustOpen(false); setAdjustValue(""); }
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-card border border-border text-sm outline-none focus:border-accent transition tabular-nums"
              />
              <button
                onClick={applyAdjust}
                disabled={shareBusy === "set" || !adjustValue.trim()}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5
                  ${shareBusy === "set" || !adjustValue.trim()
                    ? "bg-fg/20 text-fg/40 cursor-not-allowed"
                    : "bg-fg text-bg hover:bg-fg/90"}`}
              >
                {shareBusy === "set" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Aplicar
              </button>
              <button
                onClick={() => { setAdjustOpen(false); setAdjustValue(""); }}
                className="px-2 py-2 rounded-xl border border-border text-muted hover:text-fg transition"
                aria-label="Cancelar"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {shareDone && <p className="mt-2 text-xs text-accent">✅ {shareDone}</p>}
        {shareErr && <p className="mt-2 text-xs text-danger">{shareErr}</p>}
      </section>

      {/* Transactions list — per-row hide/show toggle */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs uppercase tracking-wider text-muted">Histórico</h2>
          <p className="text-[10px] text-muted">
            Clique no olho 👁 pra esconder/mostrar individualmente
          </p>
        </div>
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => {
              const effShared = localShared[r.id] ?? r.sharedAmount;
              const hidden = effShared === 0;
              const isBusy = rowBusy === r.id;
              return (
                <li
                  key={r.id}
                  className={`px-4 py-3 flex items-center gap-3 transition ${
                    hidden ? "opacity-50 bg-fg/[0.02]" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-medium truncate ${
                        hidden ? "line-through" : ""
                      }`}
                    >
                      {r.description}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted tabular-nums">
                        {formatDate(r.date)}
                      </span>
                      <span className="text-[10px] text-muted">·</span>
                      <span className="text-[10px] text-muted truncate">
                        {r.accountName}
                      </span>
                      <span className="text-[10px] text-muted">·</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          r.categoryName === "Outros"
                            ? "bg-warning/15 text-warning"
                            : "bg-fg/5 text-muted"
                        }`}
                      >
                        {r.categoryName}
                      </span>
                      {hidden && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-warning/15 text-warning">
                          ESCONDIDO
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`tabular-nums font-medium shrink-0 ${
                      r.amount < 0 ? "text-danger" : "text-accent"
                    }`}
                  >
                    {formatBRL(r.amount)}
                  </span>
                  <button
                    onClick={() => toggleRowHide(r)}
                    disabled={isBusy}
                    aria-label={hidden ? "Mostrar para Ayelet" : "Esconder do portal"}
                    title={hidden ? "Mostrar para Ayelet" : "Esconder do portal"}
                    className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition
                      ${isBusy
                        ? "border-border text-muted cursor-wait"
                        : hidden
                          ? "border-warning/30 text-warning hover:bg-warning/5"
                          : "border-border text-muted hover:text-fg hover:border-fg/30"}`}
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : hidden ? (
                      <EyeOff size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Nenhuma transação encontrada para este comerciante.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
