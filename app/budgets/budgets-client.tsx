"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Loader2, Target } from "lucide-react";
import { CategoryIcon } from "@/components/category-chip";
import { getCategoryMeta, getCategoryTree, CATEGORY_META } from "@/lib/categories/meta";
import { formatBRL } from "@/lib/format";
import { useLang } from "@/lib/i18n/context";
import { t, type Lang } from "@/lib/i18n/translations";

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
  const { lang } = useLang();
  const [adding, setAdding] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const existingSlugs = new Set(rows.map((r) => r.categorySlug));

  // System slugs that should never have budgets
  const SKIP_SLUGS = new Set(["receita", "transferencias", "cartao_pagamento"]);

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
        toast.error(j.error ?? t("budget.toast_err", lang));
        return;
      }
      toast.success(t("budget.toast_created", lang));
      setAdding(false);
      setNewSlug("");
      setNewLimit("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (confirmDelId !== id) {
      setConfirmDelId(id);
      return;
    }
    setConfirmDelId(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error(t("budget.toast_delete_err", lang));
        return;
      }
      toast.success(t("budget.toast_deleted", lang));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="space-y-2 mb-4">
        {rows.length === 0 && (
          <li className="rounded-2xl bg-accent/5 border border-accent/20 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-3">
              <Target size={22} className="text-accent" />
            </div>
            <p className="font-medium mb-1">{t("budget.empty_title", lang)}</p>
            <p className="text-sm text-muted mb-4">
              {t("budget.empty_sub", lang)}
            </p>
            {canEdit && (
              <button
                onClick={() => setAdding(true)}
                className="text-sm text-accent hover:underline font-medium"
              >
                {t("budget.add_now", lang)}
              </button>
            )}
          </li>
        )}
        {rows.map((r) => {
          const meta = getCategoryMeta(r.categorySlug);
          const over = r.spent > r.monthlyLimit;
          const remaining = r.monthlyLimit - r.spent;
          const isConfirmingDel = confirmDelId === r.id;
          return (
            <li
              key={r.id}
              className={`p-4 rounded-xl bg-card border transition ${
                over ? "border-danger/40 bg-danger/5" : "border-border"
              }`}
            >
              <div className="flex items-center gap-3 mb-2.5">
                <CategoryIcon slug={r.categorySlug} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.categoryName}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {t("budget.limit_per_month_a", lang)} {formatBRL(r.monthlyLimit)}{t("budget.limit_per_month_b", lang)}
                  </p>
                </div>
                <BudgetStatusBadge pct={r.pct} lang={lang} />
                {canEdit && (
                  <button
                    onClick={() => del(r.id)}
                    disabled={busy}
                    className={`px-2.5 py-1 rounded-lg text-xs transition inline-flex items-center gap-1 ${
                      isConfirmingDel
                        ? "bg-danger text-bg"
                        : "text-muted hover:text-danger"
                    }`}
                    aria-label={isConfirmingDel ? t("budget.confirm_delete_aria", lang) : t("budget.delete_aria", lang)}
                  >
                    <Trash2 size={12} />
                    {isConfirmingDel && t("budget.confirm", lang)}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 h-2 rounded-full bg-bg overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, r.pct)}%`,
                      backgroundColor: over ? "rgb(var(--danger))" : meta.color
                    }}
                  />
                </div>
                <span
                  className={`text-xs tabular-nums font-medium w-10 text-right ${
                    over ? "text-danger" : r.pct > 80 ? "text-warning" : "text-muted"
                  }`}
                >
                  {r.pct.toFixed(0)}%
                </span>
              </div>
              <p className={`text-xs tabular-nums ${over ? "text-danger font-medium" : "text-muted"}`}>
                {formatBRL(r.spent)} {t("budget.spent_label", lang)}
                {over ? (
                  <span className="ml-1">· ⚠ {t("budget.exceeded", lang)} {formatBRL(-remaining)}</span>
                ) : (
                  <span className="ml-1 text-muted/70">· {t("budget.left", lang)} {formatBRL(remaining)}</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      {canEdit && !adding && rows.length > 0 && (
        <button
          onClick={() => setAdding(true)}
          className="w-full p-3 rounded-xl bg-card border border-dashed border-border text-sm font-medium inline-flex items-center justify-center gap-2 hover:border-accent/40 hover:text-accent transition"
        >
          <Plus size={14} /> {t("budget.add_budget", lang)}
        </button>
      )}

      {canEdit && adding && (
        <div className="rounded-xl bg-card border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{t("budget.new_budget", lang)}</h3>
            <button onClick={() => { setAdding(false); setNewSlug(""); setNewLimit(""); }} aria-label={t("budget.cancel_aria", lang)}>
              <X size={16} className="text-muted hover:text-fg" />
            </button>
          </div>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
              {t("budget.category", lang)}
            </span>
            <select
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="w-full p-3 rounded-xl bg-bg border border-border text-sm outline-none focus:border-accent"
            >
              <option value="">{t("budget.select_category", lang)}</option>
              {getCategoryTree()
                .filter((node) => !SKIP_SLUGS.has(node.parent.slug))
                .map(({ parent, children }) => {
                  const availableChildren = children.filter(
                    (c) => !existingSlugs.has(c.slug) && !SKIP_SLUGS.has(c.slug)
                  );
                  const parentAvailable = !existingSlugs.has(parent.slug);

                  if (children.length === 0) {
                    // Leaf parent — show directly if not already budgeted
                    return parentAvailable ? (
                      <option key={parent.slug} value={parent.slug}>
                        {parent.name}
                      </option>
                    ) : null;
                  }

                  // Has subcategories
                  if (availableChildren.length === 0 && !parentAvailable) return null;
                  return (
                    <optgroup key={parent.slug} label={parent.name}>
                      {parentAvailable && (
                        <option value={parent.slug}>{parent.name} {t("budget.general_suffix", lang)}</option>
                      )}
                      {availableChildren.map((c) => (
                        <option key={c.slug} value={c.slug}>{"  "}{c.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
              {t("budget.monthly_limit", lang)}
            </span>
            <input
              inputMode="decimal"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="0,00"
              className="w-full p-3 rounded-xl bg-bg border border-border tabular-nums outline-none focus:border-accent"
            />
          </label>
          <button
            onClick={add}
            disabled={busy || !newSlug || !newLimit}
            className="w-full p-3 rounded-xl bg-accent text-bg font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 transition"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t("budget.create_budget", lang)}
          </button>
        </div>
      )}
    </>
  );
}

// Status pill mirroring the Stitch design (Excedido / Atenção / No prazo / Saudável).
function BudgetStatusBadge({ pct, lang }: { pct: number; lang: Lang }) {
  let key: "budget.status_over" | "budget.status_attention" | "budget.status_ontrack" | "budget.status_healthy";
  let cls: string;
  if (pct >= 100) {
    key = "budget.status_over";
    cls = "bg-danger/10 text-danger";
  } else if (pct >= 80) {
    key = "budget.status_attention";
    cls = "bg-warning/15 text-warning";
  } else if (pct >= 50) {
    key = "budget.status_ontrack";
    cls = "bg-accent/10 text-accent";
  } else {
    key = "budget.status_healthy";
    cls = "bg-accent/10 text-accent";
  }
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {t(key, lang)}
    </span>
  );
}
