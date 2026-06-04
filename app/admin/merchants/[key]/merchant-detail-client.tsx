"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
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
};

export function MerchantDetailClient({
  canonicalKey,
  currentCategoryId,
  categories,
  rows,
  currentShareMode,
  currentSharedTotal
}: Props) {
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState<string>(currentCategoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<"hide" | "show" | null>(null);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [shareDone, setShareDone] = useState<string | null>(null);

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

  async function applyShare(mode: "hide" | "show") {
    setShareBusy(mode);
    setShareErr(null);
    setShareDone(null);
    try {
      const r = await fetch("/api/admin/merchants/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: canonicalKey, mode })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      setShareDone(
        mode === "hide"
          ? `${formatInt(j.updated)} ${j.updated === 1 ? "transação escondida" : "transações escondidas"} do portal`
          : `${formatInt(j.updated)} ${j.updated === 1 ? "transação mostrada" : "transações mostradas"} no portal`
      );
      router.refresh();
    } catch (e) {
      setShareErr((e as Error).message);
    } finally {
      setShareBusy(null);
    }
  }

  return (
    <>
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
        <div className="flex gap-2">
          <button
            onClick={() => applyShare("hide")}
            disabled={shareBusy !== null || currentShareMode === "hide"}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition flex items-center justify-center gap-2
              ${shareBusy !== null || currentShareMode === "hide"
                ? "border-border text-fg/40 cursor-not-allowed"
                : "border-warning/40 text-warning hover:bg-warning/5 active:scale-[0.99]"}`}
          >
            {shareBusy === "hide" ? (
              <><Loader2 size={14} className="animate-spin" /> Escondendo…</>
            ) : (
              <><EyeOff size={14} /> Esconder do portal</>
            )}
          </button>
          <button
            onClick={() => applyShare("show")}
            disabled={shareBusy !== null || currentShareMode === "show"}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition flex items-center justify-center gap-2
              ${shareBusy !== null || currentShareMode === "show"
                ? "border-border text-fg/40 cursor-not-allowed"
                : "border-accent/40 text-accent hover:bg-accent/5 active:scale-[0.99]"}`}
          >
            {shareBusy === "show" ? (
              <><Loader2 size={14} className="animate-spin" /> Mostrando…</>
            ) : (
              <><Eye size={14} /> Mostrar valor real</>
            )}
          </button>
        </div>
        {shareDone && <p className="mt-2 text-xs text-accent">✅ {shareDone}</p>}
        {shareErr && <p className="mt-2 text-xs text-danger">{shareErr}</p>}
      </section>

      {/* Transactions list */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-muted mb-2 px-1">
          Histórico
        </h2>
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{r.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted tabular-nums">
                      {formatDate(r.date)}
                    </span>
                    <span className="text-[10px] text-muted">·</span>
                    <span className="text-[10px] text-muted truncate">{r.accountName}</span>
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
                  </div>
                </div>
                <span
                  className={`tabular-nums font-medium shrink-0 ${
                    r.amount < 0 ? "text-danger" : "text-accent"
                  }`}
                >
                  {formatBRL(r.amount)}
                </span>
              </li>
            ))}
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
