"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  X,
  EyeOff,
  Eye,
  Trash2,
  Sparkles,
  Save,
  Loader2,
  ArrowLeftRight
} from "lucide-react";
import { CATEGORY_META, getCategoryMeta, getCategoryTree, SYSTEM_SLUGS } from "@/lib/categories/meta";
import { formatBRL, formatDate } from "@/lib/format";
import type { Role } from "@/lib/auth/admin";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/translations";
import { safeJson } from "@/lib/http";

export type EditableTx = {
  id: string;
  date: string;
  description: string;
  amountShared: number;
  amountReal: number | null;
  categorySlug: string | null;
  isFake: boolean;
  isTransfer: boolean;
};

export function TransactionEditModal({
  tx,
  role,
  onClose
}: {
  tx: EditableTx | null;
  role: Role;
  onClose: () => void;
}) {
  const router = useRouter();
  const { lang } = useLang();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState(tx?.description ?? "");
  const [categorySlug, setCategorySlug] = useState(tx?.categorySlug ?? "outros");
  const [sharedAmount, setSharedAmount] = useState<string>(
    tx ? String(tx.amountShared) : ""
  );
  const [isTransfer, setIsTransfer] = useState(tx?.isTransfer ?? false);

  // Reset internal state when tx changes
  useEffect(() => {
    if (tx) {
      setDescription(tx.description);
      setCategorySlug(tx.categorySlug ?? "outros");
      setSharedAmount(String(tx.amountShared));
      setIsTransfer(tx.isTransfer);
    }
  }, [tx]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (tx) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx, onClose]);

  if (!tx) return null;

  const meta = getCategoryMeta(categorySlug);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/transactions/${tx!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await safeJson(r);
        toast.error(j.error ?? "erro ao salvar");
        return;
      }
      toast.success(successMsg);
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const cats = await fetch("/api/categories-map").then((r) => r.json()).catch(() => ({}));
    // map slug → id via API; if endpoint doesn't exist (it doesn't), do a lookup via a sentinel
    // Simpler: send slug + let server resolve. But our PATCH expects category_id.
    // Workaround: fetch categories once, find id by slug.
    const categoryId = cats[categorySlug];
    if (!categoryId) {
      toast.error(t("modal.t_resolve_cat", lang));
      return;
    }
    const body: Record<string, unknown> = {
      category_id: categoryId,
      description_clean: description.trim()
    };
    if (role === "admin") {
      const n = Number(String(sharedAmount).replace(",", "."));
      if (Number.isFinite(n)) body.shared_amount = n;
      body.is_transfer = isTransfer;
    }
    await patch(body, t("modal.t_updated", lang));
  }

  async function toggleHide() {
    if (role !== "admin") return;
    const isHidden = tx!.amountShared === 0;
    if (isHidden) {
      await patch({ hide: false }, "Movimento visível novamente");
    } else {
      await patch({ hide: true }, "Movimento ocultado");
    }
  }

  async function makeFake() {
    if (role !== "admin") return;
    if (!confirm("Marcar como falso? real_amount será zerado.")) return;
    await patch({ is_fake: true, real_amount: 0 }, "Marcado como falso");
  }

  async function del() {
    if (role !== "admin") return;
    if (!confirm("Apagar permanentemente este movimento?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/transactions/${tx!.id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error("erro ao apagar");
        return;
      }
      toast.success("Movimento apagado");
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const hidden = tx.amountShared === 0;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-[fadeIn_0.15s_ease-out]"
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-card border-t sm:border border-border max-h-[92vh] overflow-y-auto animate-[slideUp_0.2s_ease-out]"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
              style={{ backgroundColor: meta.color }}
            >
              <meta.Icon size={16} color="#ffffff" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{t("modal.edit_tx", lang)}</p>
              <p className="text-xs text-muted">{formatDate(tx.date)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg/60"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <Field label={t("modal.description", lang)}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-xl bg-bg border border-border outline-none focus:border-accent text-sm"
            />
          </Field>

          <Field label={t("modal.category", lang)}>
            <select
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              className="w-full p-3 rounded-xl bg-bg border border-border outline-none focus:border-accent text-sm"
            >
              {getCategoryTree().map(({ parent, children }) =>
                children.length > 0 ? (
                  <optgroup key={parent.slug} label={parent.name}>
                    <option value={parent.slug}>{parent.name} (geral)</option>
                    {children.map((c) => (
                      <option key={c.slug} value={c.slug}>{"  "}{c.name}</option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={parent.slug} value={parent.slug}>{parent.name}</option>
                )
              )}
              <optgroup label="Sistema">
                {Array.from(SYSTEM_SLUGS).map((slug) => (
                  <option key={slug} value={slug}>{CATEGORY_META[slug]?.name ?? slug}</option>
                ))}
              </optgroup>
            </select>
          </Field>

          {role === "admin" && (
            <>
              <Field
                label={`Valor mostrado (real: ${formatBRL(tx.amountReal ?? 0)})`}
              >
                <input
                  inputMode="decimal"
                  value={sharedAmount}
                  onChange={(e) => setSharedAmount(e.target.value)}
                  className="w-full p-3 rounded-xl bg-bg border border-border outline-none focus:border-accent tabular-nums"
                />
                <p className="mt-1 text-[10px] text-muted">
                  Coloque 0 para ocultar do app principal. Use o botão abaixo para alternar rapidamente.
                </p>
              </Field>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTransfer}
                  onChange={(e) => setIsTransfer(e.target.checked)}
                  className="accent-accent"
                />
                <ArrowLeftRight size={14} className="text-muted" />
                <span>Marcar como transferência</span>
                <span className="text-xs text-muted">(não conta nas despesas)</span>
              </label>
            </>
          )}

          <button
            onClick={save}
            disabled={busy}
            className="w-full p-3 rounded-xl bg-accent text-bg font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {t("modal.save_changes", lang)}
          </button>
        </div>

        {role === "admin" && (
          <div className="border-t border-border p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted mb-2">
              Ações privadas
            </p>
            <button
              onClick={toggleHide}
              disabled={busy}
              className="w-full p-3 rounded-xl bg-bg border border-border text-sm inline-flex items-center justify-center gap-2 hover:border-fg/40"
            >
              {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
              {hidden ? "Mostrar no app" : "Ocultar do app"}
            </button>
            <button
              onClick={makeFake}
              disabled={busy || tx.isFake}
              className="w-full p-3 rounded-xl bg-bg border border-border text-sm inline-flex items-center justify-center gap-2 hover:border-fg/40 disabled:opacity-50"
            >
              <Sparkles size={14} /> {tx.isFake ? "Já é falso" : "Marcar como falso"}
            </button>
            <button
              onClick={del}
              disabled={busy}
              className="w-full p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm inline-flex items-center justify-center gap-2 hover:bg-danger/20"
            >
              <Trash2 size={14} /> Apagar movimento
            </button>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
