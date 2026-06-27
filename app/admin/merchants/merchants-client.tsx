"use client";
import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Shield, Briefcase, Tag, Loader2, Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/format";
import { toast } from "sonner";

export type ClientMerchantGroup = {
  key: string;
  name: string;
  txCount: number;
  totalAbs: number;
  totalSigned: number;
  catName: string;
  isOutros: boolean;
  mixedCat: boolean;
  hiddenCount: number;
  shownCount: number;
  adjustedCount: number;
  uniqueDescCount: number;
  tagCounts: Record<string, number>; // tagSlug → count of tagged transactions
};

export type TagDef = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string;
};

type SortCol = "name" | "count" | "variations" | "total";
type SortDir = "asc" | "desc";

type Props = {
  groups: ClientMerchantGroup[];
  tags: TagDef[];
  direction: string;
  includeTransfers: boolean;
  rowsLabel: string;
  emptyLabel: string;
  filteredCount: number;
  sortBy?: string;
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

export function MerchantsClient({ groups, tags, direction, includeTransfers, rowsLabel, emptyLabel, filteredCount }: Props) {
  const router = useRouter();

  // Search + sort state
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  }

  const displayed = useMemo(() => {
    let list = [...groups];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || g.catName.toLowerCase().includes(q));
    list.sort((a, b) => {
      let diff = 0;
      if (sortCol === "name")       diff = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      else if (sortCol === "count") diff = a.txCount - b.txCount;
      else if (sortCol === "variations") diff = a.uniqueDescCount - b.uniqueDescCount;
      else                          diff = a.totalAbs - b.totalAbs;
      return sortDir === "asc" ? diff : -diff;
    });
    return list;
  }, [groups, search, sortCol, sortDir]);

  // tagCounts local state: merchantKey → tagSlug → count
  const [tagCounts, setTagCounts] = useState<Record<string, Record<string, number>>>(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const g of groups) m[g.key] = { ...g.tagCounts };
    return m;
  });
  // busyKey: "merchantKey|tagSlug" when a tag toggle is in flight
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  // hide state per merchant
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
    } catch (e) {
      setHideMode((prev) => ({ ...prev, [merchantKey]: current }));
      toast.error((e as Error).message);
    } finally {
      setHideBusy((s) => { const n = new Set(s); n.delete(merchantKey); return n; });
    }
  }, [hideBusy]);

  const toggleTag = useCallback(async (merchantKey: string, tagSlug: string, txCount: number) => {
    const busyKey = `${merchantKey}|${tagSlug}`;
    if (busyKeys.has(busyKey)) return;

    const current = tagCounts[merchantKey]?.[tagSlug] ?? 0;
    const action = current >= txCount && txCount > 0 ? "remove" : "add";

    // Optimistic update
    setBusyKeys((s) => new Set(s).add(busyKey));
    setTagCounts((prev) => ({
      ...prev,
      [merchantKey]: {
        ...prev[merchantKey],
        [tagSlug]: action === "add" ? txCount : 0
      }
    }));

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
      toast.success(
        action === "add"
          ? `${updated} despesas marcadas como ${tagSlug}`
          : `Tag ${tagSlug} removida`
      );
    } catch (e) {
      // Revert on failure
      setTagCounts((prev) => ({
        ...prev,
        [merchantKey]: { ...prev[merchantKey], [tagSlug]: current }
      }));
      toast.error((e as Error).message);
    } finally {
      setBusyKeys((s) => {
        const n = new Set(s);
        n.delete(busyKey);
        return n;
      });
    }
  }, [busyKeys, tagCounts]);

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
          const initial = (g.name[0] ?? "?").toUpperCase();
          const rank = idx + 1;
          const isTopThree = rank <= 3;

          return (
            <li key={g.key} className="relative group/row">
              {/* Clickable row — using div + onClick avoids button-in-anchor HTML issue */}
              <div
                className="grid grid-cols-[28px_1fr_60px_72px_124px_16px] gap-3 px-4 py-2.5 items-start hover:bg-surface-container transition-colors cursor-pointer group"
                onClick={() => router.push(href(g.key))}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(href(g.key)); }}
              >
                {/* Rank */}
                <span className={`text-center text-[11px] tabular-nums font-bold pt-0.5 ${isTopThree ? "text-on-surface" : "text-on-surface-variant/50"}`}>
                  {rank}
                </span>

                {/* Merchant info */}
                <div className="min-w-0 flex items-start gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                    style={{
                      background: allHidden ? "#f59e0b18" : direction === "in" ? "#6cf8bb30" : "#efeeeb",
                      color: allHidden ? "#f59e0b" : direction === "in" ? "#006c49" : "#1b1c1a"
                    }}
                  >
                    {allHidden ? <EyeOff size={12} /> : initial}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[13px] text-on-surface truncate leading-tight">{g.name}</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {/* Category badge */}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${g.isOutros ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "bg-surface-container-highest text-on-surface-variant"}`}>
                        {g.catName}{g.mixedCat ? " +" : ""}
                      </span>
                      {/* Visibility badges */}
                      {allHidden && (
                        <span className="text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#f59e0b] text-black font-bold uppercase tracking-wider">
                          <EyeOff size={8} /> Oculto
                        </span>
                      )}
                      {partialHidden && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-[#f59e0b]/10 text-[#f59e0b] uppercase tracking-wider">
                          {g.hiddenCount}/{g.txCount} ocultas
                        </span>
                      )}
                      {g.adjustedCount > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
                          {g.adjustedCount} ajust.
                        </span>
                      )}
                      {/* Ocultar / Mostrar */}
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
                      {/* Tag chips — interactive, stop propagation so they don't navigate */}
                      {tags.map((t) => {
                        const count = tagCounts[g.key]?.[t.slug] ?? 0;
                        const allTagged = count >= g.txCount && g.txCount > 0;
                        const someTagged = count > 0 && !allTagged;
                        const isBusy = busyKeys.has(`${g.key}|${t.slug}`);
                        const colors = tagColorClasses(t.color);

                        return (
                          <button
                            key={t.slug}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTag(g.key, t.slug, g.txCount);
                            }}
                            disabled={isBusy}
                            title={allTagged ? `Remover tag ${t.name}` : `Marcar todas como ${t.name}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border flex items-center gap-0.5 transition select-none
                              ${isBusy ? colors.busy + " cursor-wait" : allTagged ? colors.active : colors.ghost}
                            `}
                          >
                            {isBusy ? <Loader2 size={8} className="animate-spin" /> : <TagIcon icon={t.icon} size={8} />}
                            {t.name}
                            {someTagged && <span className="opacity-70">{count}/{g.txCount}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Count */}
                <span className="text-right text-[13px] tabular-nums text-on-surface-variant pt-0.5">
                  {formatInt(g.txCount)}
                </span>

                {/* Variations */}
                <span className="text-right text-[13px] tabular-nums text-on-surface-variant pt-0.5">
                  {formatInt(g.uniqueDescCount)}
                </span>

                {/* Total */}
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

      {/* Table footer */}
      <div className="bg-surface-container-low px-4 py-2.5 border-t border-outline-variant">
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
