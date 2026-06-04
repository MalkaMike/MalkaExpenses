"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
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
};

export function MerchantDetailClient({
  canonicalKey,
  currentCategoryId,
  categories,
  rows
}: Props) {
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState<string>(currentCategoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
