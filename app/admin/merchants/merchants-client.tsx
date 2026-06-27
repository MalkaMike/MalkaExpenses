"use client";
import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Clock, Shield, Briefcase, Tag, Loader2, Search, ChevronUp, ChevronDown, X, CheckCircle2, Circle } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/format";
import { toast } from "sonner";

export type ClientMerchantGroup = {
  key: string;
  name: string;
  txCount: number;
  totalAbs: number;
  totalSigned: number;
  catId: string | null;
  catName: string;
  isOutros: boolean;
  mixedCat: boolean;
  hiddenCount: number;
  shownCount: number;
  adjustedCount: number;
  uniqueDescCount: number;
  tagCounts: Record<string, number>;
  isReviewed: boolean;
  isDeferred: boolean;
};

export type TagDef = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string;
};

export type CategoryDef = {
  id: string;
  slug: string;
  name: string;
};

type SortCol = "name" | "count" | "variations" | "total";
type SortDir = "asc" | "desc";
type Tab = "todo" | "visible" | "hidden";

type Props = {
  groups: ClientMerchantGroup[];
  tags: TagDef[];
  direction: string;
  includeTransfers: boolean;
  onlyOutros: boolean;
  rowsLabel: string;
  emptyLabel: string;
  filteredCount: number;
  currentTab: Tab;
  todoCount: number;
  deferredCount: number;
  showDeferred: boolean;
  visibleCount: number;
  hiddenCount: number;
  todoTotal: number;
  visibleTotal: number;
  hiddenTotal: number;
  categories: CategoryDef[];
};

function tagColorClasses(color: string) {
  switch (color) {
    case "purple":  return { ghost: "border-fuchsia-500/30 text-fuchsia-400",  active: "bg-fuchsia-500 text-white border-fuchsia-500",  busy: "border-fuchsia-500/20 text-fuchsia-300" };
    case "info":    return { ghost: "border-sky-500/30 text-sky-400",          active: "bg-sky-500 text-white border-sky-500",          busy: "border-sky-500/20 text-sky-300" };
    case "warning": return { ghost: "border-amber-500/30 text-amber-400",      active: "bg-amber-500 text-white border-amber-500",      busy: "border-amber-500/20 text-amber-300" };
    case "danger":  return { ghost: "border-red-500/30 text-red-400",          active: "bg-red-500 text-white border-red-500",          busy: "border-red-500/20 text-red-300" };
    default:        return { ghost: "border-accent/30 text-accent/70",         active: "bg-accent text-bg border-accent",               busy: "border-accent/20 text-accent/50" };
  }
}

function TagIcon({ icon, size }: { icon: string; size: number }) {
  if (icon === "shield") return <Shield size={size} />;
  if (icon === "briefcase") return <Briefcase size={size} />;
  return <Tag size={size} />;
}

export function MerchantsClient({
  groups, tags, direction, includeTransfers, onlyOutros,
  rowsLabel, emptyLabel, filteredCount,
  currentTab, todoCount, deferredCount, showDeferred, visibleCount, hiddenCount,
  todoTotal, visibleTotal, hiddenTotal, categories
}: Props) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Reviewed keys — for optimistic dismiss
  // In "todo" tab: starts empty; add on check → item disappears
  // In "visible"/"hidden" tabs: starts full; remove on uncheck → item disappears
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.isReviewed).map((g) => g.key))
  );
  const [reviewBusy, setReviewBusy] = useState<Set<string>>(new Set());
  const [deferBusy, setDeferBusy] = useState<Set<string>>(new Set());
  const [deferredKeys, setDeferredKeys] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.isDeferred).map((g) => g.key))
  );

  const toggleReviewed = useCallback(async (merchantKey: string) => {
    if (reviewBusy.has(merchantKey)) return;
    const wasReviewed = reviewedKeys.has(merchantKey);
    const newSet = new Set(reviewedKeys);
    if (wasReviewed) newSet.delete(merchantKey);
    else newSet.add(merchantKey);
    setReviewedKeys(newSet);
    setReviewBusy((s) => new Set(s).add(merchantKey));
    try {
      const res = await fetch(`/api/admin/merchants/${encodeURIComponent(merchantKey)}/review`, { method: "POST" });
      if (!res.ok) { setReviewedKeys(reviewedKeys); throw new Error(`HTTP ${res.status}`); }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReviewBusy((s) => { const n = new Set(s); n.delete(merchantKey); return n; });
    }
  }, [reviewedKeys, reviewBusy, router]);

  const doDefer = useCallback(async (merchantKey: string) => {
    if (deferBusy.has(merchantKey)) return;
    setDeferredKeys((prev) => new Set(prev).add(merchantKey));
    setDeferBusy((s) => new Set(s).add(merchantKey));
    try {
      const res = await fetch(`/api/admin/merchants/${encodeURIComponent(merchantKey)}/defer`, { method: "POST" });
      if (!res.ok) {
        setDeferredKeys((prev) => { const n = new Set(prev); n.delete(merchantKey); return n; });
        throw new Error(`HTTP ${res.status}`);
      }
      toast.success("Marcado para verificar depois");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeferBusy((s) => { const n = new Set(s); n.delete(merchantKey); return n; });
    }
  }, [deferBusy, router]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir(col === "name" ? "asc" : "desc"); }
  }

  const displayed = useMemo(() => {
    let list = [...groups];
    // Optimistic dismiss: in "todo" remove newly-reviewed or newly-deferred; in other tabs remove newly-unreviewed
    if (currentTab === "todo") {
      list = list.filter((g) => !reviewedKeys.has(g.key) && !deferredKeys.has(g.key));
    } else {
      list = list.filter((g) => reviewedKeys.has(g.key));
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || g.catName.toLowerCase().includes(q));
    list.sort((a, b) => {
      let diff = 0;
      if (sortCol === "name")            diff = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      else if (sortCol === "count")      diff = a.txCount - b.txCount;
      else if (sortCol === "variations") diff = a.uniqueDescCount - b.uniqueDescCount;
      else                               diff = a.totalAbs - b.totalAbs;
      return sortDir === "asc" ? diff : -diff;
    });
    return list;
  }, [groups, search, sortCol, sortDir, currentTab, reviewedKeys, deferredKeys]);

  const [tagCounts, setTagCounts] = useState<Record<string, Record<string, number>>>(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const g of groups) m[g.key] = { ...g.tagCounts };
    return m;
  });
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  const [hideMode, setHideMode] = useState<Record<string, "hide" | "show" | "mixed">>(() => {
    const m: Record<string, "hide" | "show" | "mixed"> = {};
    for (const g of groups) {
      m[g.key] = g.hiddenCount === g.txCount && g.txCount > 0 ? "hide" : g.hiddenCount === 0 ? "show" : "mixed";
    }
    return m;
  });
  const [hideBusy, setHideBusy] = useState<Set<string>>(new Set());

  const toggleHide = useCallback(async (merchantKey: string, current: "hide" | "show" | "mixed") => {
    if (hideBusy.has(merchantKey)) return;
    const endpoint = current === "hide" ? "unhide" : "hide";
    setHideBusy((s) => new Set(s).add(merchantKey));
    setHideMode((prev) => ({ ...prev, [merchantKey]: endpoint === "hide" ? "hide" : "show" }));
    try {
      const res = await fetch(`/api/admin/merchants/${encodeURIComponent(merchantKey)}/${endpoint}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(endpoint === "hide" ? "Ocultado do portal" : "Visível no portal");
      router.refresh();
    } catch (e) {
      setHideMode((prev) => ({ ...prev, [merchantKey]: current }));
      toast.error((e as Error).message);
    } finally {
      setHideBusy((s) => { const n = new Set(s); n.delete(merchantKey); return n; });
    }
  }, [hideBusy, router]);

  // ── Category picker ────────────────────────────────────────────────────────
  const [openCatPicker, setOpenCatPicker] = useState<string | null>(null);
  const [catPickerPos, setCatPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [catOverrides, setCatOverrides] = useState<Record<string, { id: string; name: string; isOutros: boolean }>>({});
  const [catBusy, setCatBusy] = useState<Set<string>>(new Set());

  // Close picker on outside click or scroll
  useEffect(() => {
    if (!openCatPicker) return;
    const close = () => setOpenCatPicker(null);
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => { document.removeEventListener("click", close); window.removeEventListener("scroll", close); };
  }, [openCatPicker]);

  const openCategoryPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>, merchantKey: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setCatPickerPos({ top: rect.bottom + 4, left: rect.left });
    setOpenCatPicker(merchantKey);
  }, []);

  const saveCategory = useCallback(async (merchantKey: string, newCatId: string) => {
    const newCat = categories.find((c) => c.id === newCatId);
    if (!newCat) return;
    setOpenCatPicker(null);
    setCatOverrides((prev) => ({ ...prev, [merchantKey]: { id: newCatId, name: newCat.name, isOutros: newCat.slug === "outros" } }));
    setCatBusy((prev) => new Set(prev).add(merchantKey));
    try {
      const res = await fetch("/api/admin/merchants/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: merchantKey, category_id: newCatId })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setCatOverrides((prev) => { const n = { ...prev }; delete n[merchantKey]; return n; });
      toast.error((e as Error).message);
    } finally {
      setCatBusy((prev) => { const n = new Set(prev); n.delete(merchantKey); return n; });
    }
  }, [categories, router]);

  const HIDE_TAGS = ["kenlo", "laik"];
  const SHOW_TAGS = ["insurance"];

  const toggleTag = useCallback(async (merchantKey: string, tagSlug: string, txCount: number) => {
    const busyKey = `${merchantKey}|${tagSlug}`;
    if (busyKeys.has(busyKey)) return;
    const current = tagCounts[merchantKey]?.[tagSlug] ?? 0;
    const action = current >= txCount && txCount > 0 ? "remove" : "add";
    setBusyKeys((s) => new Set(s).add(busyKey));
    setTagCounts((prev) => ({
      ...prev,
      [merchantKey]: { ...prev[merchantKey], [tagSlug]: action === "add" ? txCount : 0 }
    }));
    // Applying a tag = review decision: mark reviewed + apply visibility rule optimistically
    if (action === "add") {
      setReviewedKeys((prev) => new Set(prev).add(merchantKey));
      if (HIDE_TAGS.includes(tagSlug)) {
        setHideMode((prev) => ({ ...prev, [merchantKey]: "hide" }));
      } else if (SHOW_TAGS.includes(tagSlug)) {
        setHideMode((prev) => ({ ...prev, [merchantKey]: "show" }));
      }
    }
    try {
      const res = await fetch(`/api/admin/merchants/${encodeURIComponent(merchantKey)}/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_slug: tagSlug, action })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { updated } = await res.json();
      toast.success(action === "add" ? `${updated} despesas marcadas como ${tagSlug}` : `Tag ${tagSlug} removida`);
      router.refresh();
    } catch (e) {
      setTagCounts((prev) => ({ ...prev, [merchantKey]: { ...prev[merchantKey], [tagSlug]: current } }));
      if (action === "add") setReviewedKeys((prev) => { const n = new Set(prev); n.delete(merchantKey); return n; });
      toast.error((e as Error).message);
    } finally {
      setBusyKeys((s) => { const n = new Set(s); n.delete(busyKey); return n; });
    }
  }, [busyKeys, tagCounts, router]);

  const tabHref = (tab: Tab, withDeferred?: boolean) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (direction !== "out") params.set("direction", direction);
    if (includeTransfers) params.set("transfers", "1");
    if (onlyOutros) params.set("outros", "1");
    if (withDeferred) params.set("deferred", "1");
    return `/admin/merchants?${params.toString()}`;
  };

  const href = (key: string) =>
    `/admin/merchants/${encodeURIComponent(key)}?direction=${direction}${includeTransfers ? "&transfers=1" : ""}`;

  function SortBtn({ col, label, className }: { col: SortCol; label: string; className?: string }) {
    const active = sortCol === col;
    const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : null;
    return (
      <button
        onClick={() => toggleSort(col)}
        className={`flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider transition select-none
          ${active ? "text-primary" : "text-on-surface-variant hover:text-on-surface"} ${className ?? ""}`}
      >
        {label}
        {Icon ? <Icon size={10} /> : <span className="w-[10px]" />}
      </button>
    );
  }

  return (
    <>
      {/* ── 3-tab nav ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-outline-variant bg-surface-container-low">
        {(["todo", "visible", "hidden"] as const).map((tab) => {
          const active = currentTab === tab;
          const count = tab === "todo" ? todoCount : tab === "visible" ? visibleCount : hiddenCount;
          const total = tab === "todo" ? todoTotal : tab === "visible" ? visibleTotal : hiddenTotal;
          const label = tab === "todo" ? "Para revisar" : tab === "visible" ? "Visíveis para Ayelet" : "Ocultos de Ayelet";
          return (
            <button
              key={tab}
              onClick={() => router.push(tabHref(tab))}
              className={`flex-1 px-3 py-2 text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 transition border-b-2
                ${active
                  ? "border-primary text-primary bg-surface-container-lowest"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container"}`}
            >
              <div className="flex items-center gap-1.5">
                {label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                  ${active ? "bg-primary/10 text-primary" : "bg-surface-container-highest text-on-surface-variant"}`}>
                  {formatInt(count)}
                </span>
              </div>
              <span className={`text-[10px] font-medium tabular-nums ${active ? "text-primary/70" : "text-on-surface-variant/60"}`}>
                {formatBRL(total)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search input */}
      <div className="px-4 py-2.5 border-b border-outline-variant bg-surface-container-low">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar ${rowsLabel}…`}
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg bg-surface-container border border-outline-variant text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Sortable column headers */}
      <div className="grid grid-cols-[28px_1fr_60px_72px_124px_16px] gap-3 px-4 py-2.5 border-b border-outline-variant bg-surface-container-low">
        <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant text-center">#</span>
        <SortBtn col="name" label={direction === "in" ? "Pagador" : "Comerciante"} />
        <SortBtn col="count" label="Vezes" className="justify-end" />
        <SortBtn col="variations" label="Variações" className="justify-end" />
        <SortBtn col="total" label="Total" className="justify-end" />
        <span />
      </div>

      <ul className="divide-y divide-outline-variant">
        {displayed.map((g, idx) => {
          const currentHideMode = hideMode[g.key] ?? (g.hiddenCount === g.txCount && g.txCount > 0 ? "hide" : g.hiddenCount === 0 ? "show" : "mixed");
          const allHidden = currentHideMode === "hide";
          const partialHidden = currentHideMode === "mixed";
          const isHideBusy = hideBusy.has(g.key);
          const isReviewed = reviewedKeys.has(g.key);
          const isReviewBusy = reviewBusy.has(g.key);
          const isDeferBusy = deferBusy.has(g.key);
          const rank = idx + 1;
          const isTopThree = rank <= 3;

          return (
            <li key={g.key} className="relative group/row">
              <div
                className="grid grid-cols-[28px_1fr_60px_72px_124px_16px] gap-3 px-4 py-2.5 items-center hover:bg-surface-container transition-colors cursor-pointer group"
                onClick={() => router.push(href(g.key))}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(href(g.key)); }}
              >
                {/* Rank */}
                <span className={`text-center text-[11px] tabular-nums font-bold ${isTopThree ? "text-on-surface" : "text-on-surface-variant/50"}`}>
                  {rank}
                </span>

                {/* Merchant info */}
                <div className="min-w-0">
                  <p className="font-semibold text-[13px] text-on-surface truncate leading-tight">{g.name}</p>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {/* ✓ reviewed + 👁 review-and-hide — inline with chips */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleReviewed(g.key); }}
                      disabled={isReviewBusy}
                      title={isReviewed ? "Desmarcar como revisado" : "Revisado — visível para Ayelet"}
                      className={`h-[18px] w-[18px] rounded flex items-center justify-center transition-all shrink-0
                        ${isReviewBusy ? "opacity-40 cursor-wait" :
                          isReviewed ? "text-secondary" :
                          "text-on-surface-variant/30 hover:text-secondary/60"}`}
                    >
                      {isReviewBusy ? <Loader2 size={12} className="animate-spin" /> : isReviewed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </button>
                    {currentTab === "todo" && !g.isDeferred && (
                      <button
                        onClick={(e) => { e.stopPropagation(); doDefer(g.key); }}
                        disabled={isDeferBusy}
                        title="Verificar depois — sem efeito na visibilidade de Ayelet"
                        className={`h-[18px] w-[18px] rounded flex items-center justify-center transition-all shrink-0
                          ${isDeferBusy ? "opacity-40 cursor-wait" :
                            "text-on-surface-variant/30 hover:text-sky-400/80"}`}
                      >
                        {isDeferBusy ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
                      </button>
                    )}
                    {g.isDeferred && (
                      <span onClick={(e) => e.stopPropagation()} className="text-[9px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-bold uppercase tracking-wider">
                        <Clock size={8} /> adiado
                      </span>
                    )}
                    {(() => {
                      const ov = catOverrides[g.key];
                      const dispName = ov?.name ?? g.catName;
                      const dispIsOutros = ov ? ov.isOutros : g.isOutros;
                      const isBusy = catBusy.has(g.key);
                      return (
                        <button
                          onClick={(e) => openCategoryPicker(e, g.key)}
                          disabled={isBusy}
                          title="Clique para trocar categoria"
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider transition
                            hover:ring-1 hover:ring-primary/40
                            ${dispIsOutros ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "bg-surface-container-highest text-on-surface-variant"}
                            ${isBusy ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                        >
                          {dispName}{!ov && g.mixedCat ? " +" : ""}
                        </button>
                      );
                    })()}
                    {allHidden && (
                      <span onClick={(e) => e.stopPropagation()} className="text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#f59e0b] text-black font-bold uppercase tracking-wider">
                        <EyeOff size={8} /> Oculto
                      </span>
                    )}
                    {partialHidden && (
                      <span onClick={(e) => e.stopPropagation()} className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-[#f59e0b]/10 text-[#f59e0b] uppercase tracking-wider">
                        {g.hiddenCount}/{g.txCount} ocultas
                      </span>
                    )}
                    {g.adjustedCount > 0 && (
                      <span onClick={(e) => e.stopPropagation()} className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
                        {g.adjustedCount} ajust.
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleHide(g.key, currentHideMode); }}
                      disabled={isHideBusy}
                      title={allHidden ? "Tornar visível no portal" : "Ocultar do portal"}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border flex items-center gap-0.5 transition select-none
                        ${isHideBusy ? "border-amber-500/20 text-amber-300 cursor-wait" : allHidden ? "bg-amber-500 text-black border-amber-500" : "border-amber-500/30 text-amber-500"}`}
                    >
                      {isHideBusy ? <Loader2 size={8} className="animate-spin" /> : allHidden ? <Eye size={8} /> : <EyeOff size={8} />}
                      {allHidden ? "Mostrar" : "Ocultar"}
                    </button>
                    {tags.map((t) => {
                      const count = tagCounts[g.key]?.[t.slug] ?? 0;
                      const allTagged = count >= g.txCount && g.txCount > 0;
                      const someTagged = count > 0 && !allTagged;
                      const isBusy = busyKeys.has(`${g.key}|${t.slug}`);
                      const colors = tagColorClasses(t.color);
                      return (
                        <button
                          key={t.slug}
                          onClick={(e) => { e.stopPropagation(); toggleTag(g.key, t.slug, g.txCount); }}
                          disabled={isBusy}
                          title={allTagged ? `Remover tag ${t.name}` : `Marcar todas como ${t.name}`}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border flex items-center gap-0.5 transition select-none
                            ${isBusy ? colors.busy + " cursor-wait" : allTagged ? colors.active : colors.ghost}`}
                        >
                          {isBusy ? <Loader2 size={8} className="animate-spin" /> : <TagIcon icon={t.icon} size={8} />}
                          {t.name}
                          {someTagged && <span className="opacity-70">{count}/{g.txCount}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <span className="text-right text-[13px] tabular-nums text-on-surface-variant pt-0.5">
                  {formatInt(g.txCount)}
                </span>
                <span className="text-right text-[13px] tabular-nums text-on-surface-variant pt-0.5">
                  {formatInt(g.uniqueDescCount)}
                </span>
                <span className={`text-right text-[13px] font-semibold tabular-nums pt-0.5 ${direction === "in" ? "text-secondary" : "text-on-tertiary-container"}`}>
                  {formatBRL(g.totalAbs)}
                </span>
                <ChevronRight size={13} className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition mt-0.5" />
              </div>
            </li>
          );
        })}
      </ul>

      {displayed.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-on-surface-variant">
          {search ? `Nenhum resultado para "${search}"` : emptyLabel}
        </p>
      )}

      {/* ── Category picker (fixed, escapes overflow:hidden) ─────────────── */}
      {openCatPicker && catPickerPos && (
        <div
          style={{ position: "fixed", top: catPickerPos.top, left: catPickerPos.left }}
          className="z-50 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-xl py-1 min-w-[180px] max-h-[260px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {categories.map((cat) => {
            const currentCatId = catOverrides[openCatPicker]?.id ?? groups.find((g) => g.key === openCatPicker)?.catId;
            const isSelected = cat.id === currentCatId;
            return (
              <button
                key={cat.id}
                onClick={() => saveCategory(openCatPicker, cat.id)}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition hover:bg-surface-container
                  ${isSelected ? "font-bold text-primary bg-primary/5" : "text-on-surface"}`}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      {currentTab === "todo" && deferredCount > 0 && (
        <div className="px-4 py-2 border-t border-outline-variant bg-surface-container-low text-center">
          {showDeferred ? (
            <button
              onClick={() => router.push(tabHref("todo"))}
              className="text-xs text-sky-400 hover:text-sky-300 transition inline-flex items-center gap-1"
            >
              <Clock size={11} /> Ocultar adiados
            </button>
          ) : (
            <button
              onClick={() => router.push(tabHref("todo", true))}
              className="text-xs text-on-surface-variant hover:text-on-surface transition inline-flex items-center gap-1"
            >
              <Clock size={11} />
              {deferredCount} {deferredCount === 1 ? "comerciante adiado" : "comerciantes adiados"} — ver
            </button>
          )}
        </div>
      )}

      <div className="bg-surface-container-low px-4 py-2.5 border-t border-outline-variant flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-on-surface-variant">
          {search
            ? `${formatInt(displayed.length)} de ${formatInt(groups.length)} ${rowsLabel}`
            : `${formatInt(groups.length)} ${rowsLabel}`
          } · {formatInt(filteredCount)} transações
        </span>
      </div>
    </>
  );
}
