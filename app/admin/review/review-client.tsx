"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, ChevronDown, ChevronUp, Loader2, Wand2 } from "lucide-react";
import { CATEGORY_ORDER, CATEGORY_META, getCategoryMeta } from "@/lib/categories/meta";
import { formatBRL, formatDate } from "@/lib/format";

export type ReviewRow = {
  id: string;
  accountName: string;
  date: string;
  description: string;
  descriptionRaw: string;
  amountReal: number;
  amountShared: number;
  confidence: number | null;
  reasoning: string | null;
  status: string;
  isFake: boolean;
  isTransfer: boolean;
  categorySlug: string;
};

export function ReviewClient({ rows: initial }: { rows: ReviewRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const [categoryMap, setCategoryMap] = useState<Record<string, string> | null>(null);

  const allSelected = selected.size > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function ensureCategoryMap() {
    if (categoryMap) return categoryMap;
    const r = await fetch("/api/categories-map");
    const j = (await r.json()) as Record<string, string>;
    setCategoryMap(j);
    return j;
  }

  async function patchOne(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? "patch failed");
    }
    return r.json();
  }

  async function approveOne(id: string) {
    setBusy(true);
    try {
      await patchOne(id, { description_clean: rows.find((r) => r.id === id)?.description });
      // status auto-set to user_edited by API; this confirms the current category
      toast.success("Categoria confirmada");
      setRows((rs) => rs.filter((r) => r.id !== id));
      setSelected((s) => {
        const ns = new Set(s);
        ns.delete(id);
        return ns;
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function recategorizeOne(id: string, slug: string) {
    setBusy(true);
    try {
      const cmap = await ensureCategoryMap();
      const catId = cmap[slug];
      if (!catId) throw new Error("categoria não encontrada");
      await patchOne(id, { category_id: catId });
      toast.success(`Movido para ${CATEGORY_META[slug]?.name ?? slug}`);
      setRows((rs) => rs.filter((r) => r.id !== id));
      setSelected((s) => {
        const ns = new Set(s);
        ns.delete(id);
        return ns;
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const id of selected) {
        try {
          await patchOne(id, {
            description_clean: rows.find((r) => r.id === id)?.description
          });
          ok++;
        } catch {
          fail++;
        }
      }
      toast.success(`${ok} confirmados${fail > 0 ? ` · ${fail} falharam` : ""}`);
      setRows((rs) => rs.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function bulkRecategorize() {
    if (selected.size === 0 || !bulkCategory) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    try {
      const cmap = await ensureCategoryMap();
      const catId = cmap[bulkCategory];
      if (!catId) throw new Error("categoria não encontrada");
      for (const id of selected) {
        try {
          await patchOne(id, { category_id: catId });
          ok++;
        } catch {
          fail++;
        }
      }
      toast.success(
        `${ok} movidos para ${CATEGORY_META[bulkCategory]?.name}${fail > 0 ? ` · ${fail} falharam` : ""}`
      );
      setRows((rs) => rs.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      setBulkCategory("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-accent/10 border border-accent/30 p-8 text-center">
        <Check size={32} className="mx-auto text-accent mb-2" />
        <h2 className="font-medium mb-1">Tudo revisado!</h2>
        <p className="text-sm text-muted">Nada pendente.</p>
        <button
          onClick={() => router.push("/admin")}
          className="mt-4 px-4 py-2 rounded-xl bg-fg text-bg text-sm font-medium"
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Bulk action bar */}
      <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur -mx-4 px-4 py-3 mb-4 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-accent"
            />
            <span className="text-muted">
              {selected.size > 0 ? `${selected.size} selecionados` : "selecionar todos"}
            </span>
          </label>
          {someSelected && (
            <div className="flex items-center gap-2">
              <select
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-full bg-card border border-border outline-none"
              >
                <option value="">categoria...</option>
                {CATEGORY_ORDER.map((slug) => (
                  <option key={slug} value={slug}>
                    {CATEGORY_META[slug].name}
                  </option>
                ))}
              </select>
              <button
                disabled={!bulkCategory || busy}
                onClick={bulkRecategorize}
                className="text-xs px-3 py-1.5 rounded-full bg-accent text-bg font-medium disabled:opacity-50 inline-flex items-center gap-1"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                aplicar
              </button>
              <button
                disabled={busy}
                onClick={bulkApprove}
                className="text-xs px-3 py-1.5 rounded-full bg-card border border-border disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Check size={11} /> confirmar
              </button>
            </div>
          )}
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => {
          const meta = getCategoryMeta(r.categorySlug);
          const isExpanded = expanded === r.id;
          const isSel = selected.has(r.id);
          const conf = r.confidence !== null ? Math.round(r.confidence * 100) : null;
          return (
            <li
              key={r.id}
              className={`rounded-xl border p-3 transition ${
                isSel ? "border-accent bg-accent/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(r.id)}
                  className="accent-accent shrink-0"
                />
                <button
                  onClick={() => setExpanded(isExpanded ? null : r.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="font-medium truncate">{r.description}</p>
                    <p
                      className={`tabular-nums font-semibold shrink-0 ${
                        r.amountReal > 0 ? "text-accent" : ""
                      }`}
                    >
                      {r.amountReal > 0 ? "+" : ""}
                      {formatBRL(r.amountReal)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          backgroundColor: `${meta.color}1F`,
                          color: meta.color
                        }}
                      >
                        {meta.name}
                      </span>
                      <span>·</span>
                      <span>{r.accountName}</span>
                      <span>·</span>
                      <span>{formatDate(r.date)}</span>
                    </span>
                    {conf !== null && (
                      <span
                        className={`tabular-nums ${
                          conf < 60 ? "text-danger" : conf < 90 ? "text-fg" : "text-accent"
                        }`}
                      >
                        {conf}%
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => setExpanded(isExpanded ? null : r.id)}
                  className="p-1 text-muted shrink-0"
                  aria-label={isExpanded ? "Recolher" : "Expandir"}
                >
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {isExpanded && (
                <div className="mt-3 pl-7 space-y-3">
                  {r.reasoning && (
                    <p className="text-xs text-muted italic leading-relaxed">
                      🤖 {r.reasoning}
                    </p>
                  )}
                  <p className="text-[10px] text-muted font-mono">
                    {r.descriptionRaw}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => approveOne(r.id)}
                      disabled={busy}
                      className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Check size={11} /> confirmar
                    </button>
                    {CATEGORY_ORDER.filter((s) => s !== r.categorySlug)
                      .slice(0, 6)
                      .map((slug) => {
                        const m = CATEGORY_META[slug];
                        return (
                          <button
                            key={slug}
                            disabled={busy}
                            onClick={() => recategorizeOne(r.id, slug)}
                            className="text-xs px-2.5 py-1 rounded-full bg-card border border-border inline-flex items-center gap-1 disabled:opacity-50 hover:border-fg/40"
                          >
                            <m.Icon size={11} style={{ color: m.color }} />
                            {m.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
