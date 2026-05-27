"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Loader2 } from "lucide-react";
import { CategoryIcon } from "@/components/category-chip";
import { getCategoryMeta, CATEGORY_ORDER, CATEGORY_META } from "@/lib/categories/meta";
import { formatBRL } from "@/lib/format";

export type BudgetRow = {
  id: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  monthlyLimit: number;
  spent: number;
  pct: number;
  notes: string | null;
};

export function BudgetsClient({ rows, canEdit }: { rows: BudgetRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const existingSlugs = new Set(rows.map((r) => r.categorySlug));

  async function add() {
    if (!newSlug || !newLimit) return;
    setBusy(true);
    try {
      const r = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_slug: newSlug,
          monthly_limit: Number(newLimit.replace(",", "."))
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error ?? "erro");
        return;
      }
      toast.success("Orçamento criado");
      setAdding(false);
      setNewSlug("");
      setNewLimit("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Apagar este orçamento?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error("erro");
        return;
      }
      toast.success("Orçamento apagado");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="space-y-2 mb-4">
        {rows.length === 0 && (
          <li className="rounded-2xl bg-card border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted mb-1">Nenhum orçamento configurado.</p>
            <p className="text-xs text-muted">
              Adicione um para acompanhar seus gastos por categoria.
            </p>
          </li>
        )}
        {rows.map((r) => {
          const meta = getCategoryMeta(r.categorySlug);
          const over = r.spent > r.monthlyLimit;
          const remaining = r.monthlyLimit - r.spent;
          return (
            <li
              key={r.id}
              className={`p-4 rounded-xl bg-card border transition ${
                over ? "border-danger/40" : "border-border"
              }`}
            >
              <div className="flex items-center gap-3 mb-2.5">
                <CategoryIcon slug={r.categorySlug} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.categoryName}</p>
                  <p className="text-xs text-muted">
                    Limite: <span className="tabular-nums">{formatBRL(r.monthlyLimit)}</span>
                  </p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => del(r.id)}
                    disabled={busy}
                    className="p-1.5 text-muted hover:text-danger"
                    aria-label="Apagar"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-2 rounded-full bg-bg overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, r.pct)}%`,
                      backgroundColor: over ? "rgb(var(--danger))" : meta.color
                    }}
                  />
                </div>
                <span className="text-xs tabular-nums w-12 text-right">{r.pct.toFixed(0)}%</span>
              </div>
              <p className={`text-xs tabular-nums ${over ? "text-danger" : "text-muted"}`}>
                {formatBRL(r.spent)} de {formatBRL(r.monthlyLimit)}{" "}
                {over ? (
                  <span>· excedeu {formatBRL(-remaining)}</span>
                ) : (
                  <span>· resta {formatBRL(remaining)}</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="w-full p-3 rounded-xl bg-card border border-dashed border-border text-sm font-medium inline-flex items-center justify-center gap-2 hover:border-accent/40"
        >
          <Plus size={14} /> Adicionar orçamento
        </button>
      )}

      {canEdit && adding && (
        <div className="rounded-xl bg-card border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Novo orçamento</h3>
            <button onClick={() => setAdding(false)} aria-label="Cancelar">
              <X size={16} className="text-muted" />
            </button>
          </div>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
              Categoria
            </span>
            <select
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="w-full p-3 rounded-xl bg-bg border border-border text-sm outline-none"
            >
              <option value="">selecione...</option>
              {CATEGORY_ORDER.filter((s) => !existingSlugs.has(s) && s !== "receita" && s !== "transferencias" && s !== "cartao_pagamento").map((slug) => (
                <option key={slug} value={slug}>
                  {CATEGORY_META[slug].name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
              Limite mensal (R$)
            </span>
            <input
              inputMode="decimal"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              placeholder="0,00"
              className="w-full p-3 rounded-xl bg-bg border border-border tabular-nums outline-none"
            />
          </label>
          <button
            onClick={add}
            disabled={busy || !newSlug || !newLimit}
            className="w-full p-3 rounded-xl bg-accent text-bg font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Criar
          </button>
        </div>
      )}
    </>
  );
}
