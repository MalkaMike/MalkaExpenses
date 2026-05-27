"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Loader2, Wand2, Globe, HelpCircle, AlertCircle } from "lucide-react";
import { CATEGORY_META, getCategoryMeta, getCategoryTree, getCategoryParent } from "@/lib/categories/meta";
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

// ── Confidence badge ───────────────────────────────────────────────────────────
// Three tiers surfaced in the review queue:
//  ≥ 0.85   → auto_accepted (never reaches review queue)
//  0.65–0.84 → amber "IA incerta"
//  < 0.65   → blue "Pesquisado" (if web search ran) or red "IA não sabe"
function ConfidenceBadge({
  confidence,
  reasoning
}: {
  confidence: number | null;
  reasoning: string | null;
}) {
  if (confidence === null) return null;

  const searched = reasoning?.startsWith("Pesquisado:");
  const unknown  = reasoning?.startsWith("IA não sabe");

  if (confidence >= 0.85) return null; // auto-accepted, shouldn't be in queue

  if (searched) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
        <Globe size={9} /> Pesquisado
      </span>
    );
  }

  if (unknown || confidence < 0.4) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-danger/10 text-danger border border-danger/20">
        <HelpCircle size={9} /> IA não sabe
      </span>
    );
  }

  // 0.40–0.84: uncertain
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-warning/10 text-warning border border-warning/20">
      <AlertCircle size={9} /> IA incerta
    </span>
  );
}

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
                className="text-xs px-2 py-1.5 rounded-full bg-card border border-border outline-none max-w-[160px]"
              >
                <option value="">categoria...</option>
                {getCategoryTree().map(({ parent, children }) => (
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
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                        style={{
                          backgroundColor: `${meta.color}1F`,
                          color: meta.color
                        }}
                      >
                        {meta.name}
                      </span>
                      <span className="shrink-0">·</span>
                      <span className="truncate">{r.accountName}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{formatDate(r.date)}</span>
                    </span>
                    <ConfidenceBadge confidence={r.confidence} reasoning={r.reasoning} />
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
                    <p className={`text-xs leading-relaxed ${
                      r.reasoning.startsWith("Pesquisado:")
                        ? "text-accent italic"
                        : r.reasoning.startsWith("IA não sabe")
                        ? "text-danger italic"
                        : "text-muted italic"
                    }`}>
                      {r.reasoning.startsWith("Pesquisado:") ? "🌐" :
                       r.reasoning.startsWith("IA não sabe") ? "❓" : "🤖"} {r.reasoning}
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
                    {/* Quick-pick: siblings of current category first, then top-level parents */}
                    {(() => {
                      const parentSlug = getCategoryParent(r.categorySlug).slug;
                      // Siblings = other subcategories of same parent (most relevant)
                      const siblings = Object.values(CATEGORY_META).filter(
                        (m) => m.parentSlug === parentSlug && m.slug !== r.categorySlug
                      );
                      // Fallback: top-level parents excluding current
                      const topLevel = getCategoryTree()
                        .map((n) => n.parent)
                        .filter((p) => p.slug !== parentSlug && p.slug !== r.categorySlug);
                      // Show up to 6: siblings first, then top-level fill
                      const picks = [...siblings, ...topLevel].slice(0, 6);
                      return picks.map((m) => (
                        <button
                          key={m.slug}
                          disabled={busy}
                          onClick={() => recategorizeOne(r.id, m.slug)}
                          className="text-xs px-2.5 py-1 rounded-full bg-card border border-border inline-flex items-center gap-1 disabled:opacity-50 hover:border-fg/40"
                        >
                          <m.Icon size={11} style={{ color: m.color }} />
                          {m.parentSlug
                            ? `${CATEGORY_META[m.parentSlug]?.name ?? ""} › ${m.name}`
                            : m.name}
                        </button>
                      ));
                    })()}
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
