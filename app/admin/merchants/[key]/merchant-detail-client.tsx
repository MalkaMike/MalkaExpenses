"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2, Pencil, X, Briefcase, Shield, Tag, GitMerge, Search, ExternalLink, Undo2, ArrowUpDown, CheckCheck, ShieldQuestion, ShieldCheck, ShieldAlert, RotateCw } from "lucide-react";
import { formatBRL, formatDate, formatInt } from "@/lib/format";
import { ReceiptFinderButton } from "@/components/receipt-finder-button";
import { MoveDescriptionButton } from "@/components/move-description-button";
import { safeJson } from "@/lib/http";

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
  gmailSearched: boolean;
  gmailMatchCount: number;
};

type ReimbTag = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string;
  appliedCount: number;
};

type ClusterOption = { key: string; name: string };
type MergeHistoryItem = { id: string; sourceName: string; createdAt: string; hasDescriptions: boolean };
type CategoryOption = { id: string; slug: string; name: string };
type ResearchResult = {
  verdict: "legitimo" | "suspeito" | "desconhecido";
  summary: string;
  cnpj: string | null;
  cnpjData: Record<string, string | null> | null;
  sources: { title: string; url: string }[];
  updatedAt: string;
};

type Props = {
  canonicalKey: string;
  rows: Row[];
  currentShareMode: "hide" | "show" | "mixed";
  currentSharedTotal: number;
  currentName: string;
  tags: ReimbTag[];
  allClusters: ClusterOption[];
  mergeHistory: MergeHistoryItem[];
  role: "admin" | "health";  // health = Ayelet: read-only, no ocultar/aprovar controls
  pendingCount: number;
  categories: CategoryOption[];
  uniformCategoryId: string | null;
  research: ResearchResult | null;
};

export function MerchantDetailClient({
  canonicalKey,
  rows,
  currentShareMode,
  currentSharedTotal,
  currentName,
  tags,
  allClusters,
  mergeHistory,
  role,
  pendingCount,
  categories,
  uniformCategoryId,
  research
}: Props) {
  const router = useRouter();
  const [shareBusy, setShareBusy] = useState<"hide" | "show" | "set" | null>(null);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [shareDone, setShareDone] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");

  // Google Sheets export state
  const [sheetsBusy, setSheetsBusy] = useState(false);
  const [sheetsErr, setSheetsErr] = useState<string | null>(null);

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentName);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  // Multi-select merge state
  // selectedForMerge: canonical_key → ClusterOption for each checked merchant
  const [selectedForMerge, setSelectedForMerge] = useState<Map<string, ClusterOption>>(new Map());
  const [finalName, setFinalName] = useState(currentName);
  const [multiMergeBusy, setMultiMergeBusy] = useState(false);
  const [multiMergeErr, setMultiMergeErr] = useState<string | null>(null);
  const [multiMergeDone, setMultiMergeDone] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Per-row pending state (which tx is currently being toggled)
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Optimistic local override of sharedAmount per row id
  const [localShared, setLocalShared] = useState<Record<string, number>>({});

  // Reimbursement tag bulk-apply state
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [tagDone, setTagDone] = useState<string | null>(null);

  // Transaction table sort
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Undo merge state
  const [undoBusy, setUndoBusy] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<string | null>(null);
  const [undoDone, setUndoDone] = useState<string | null>(null);

  // Aprovar todas — bulk categorize + share + advance status in one shot
  const [approveCatId, setApproveCatId] = useState(uniformCategoryId ?? "");
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [approveDone, setApproveDone] = useState<string | null>(null);

  // Deep research — CNPJ lookup + search-grounded AI verdict on an unrecognized merchant
  const [researchResult, setResearchResult] = useState(research);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchErr, setResearchErr] = useState<string | null>(null);

  function toggleSort(col: "date" | "amount") {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  const sortedRows = [...rows].sort((a, b) => {
    if (sortBy === "date") {
      const diff = a.date.localeCompare(b.date);
      return sortDir === "desc" ? -diff : diff;
    }
    const diff = Math.abs(a.amount) - Math.abs(b.amount);
    return sortDir === "desc" ? -diff : diff;
  });

  async function undoMerge(modId: string) {
    setUndoBusy(modId);
    setUndoErr(null);
    setUndoDone(null);
    try {
      const r = await fetch("/api/admin/merchants/merge/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modification_id: modId })
      });
      const j = await safeJson(r);
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erro ${r.status}`);
      const jj = j as { source_name?: string; restored_descriptions?: number };
      setUndoDone(`"${jj.source_name}" separado novamente (${jj.restored_descriptions} descrições restauradas)`);
      router.refresh();
    } catch (e) {
      setUndoErr((e as Error).message);
    } finally {
      setUndoBusy(null);
    }
  }

  async function bulkTag(tagSlug: string, action: "add" | "remove") {
    setTagBusy(tagSlug);
    setTagDone(null);
    try {
      const r = await fetch("/api/admin/reimbursements/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_ids: rows.map((row) => row.id),
          tag_slug: tagSlug,
          action
        })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      const j = await r.json();
      const name = tags.find((t) => t.slug === tagSlug)?.name ?? tagSlug;
      setTagDone(
        action === "add"
          ? `${formatInt(j.updated)} ${j.updated === 1 ? "despesa marcada" : "despesas marcadas"} como ${name}`
          : `${formatInt(j.updated)} ${j.updated === 1 ? "despesa desmarcada" : "despesas desmarcadas"} de ${name}`
      );
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setTagBusy(null);
    }
  }

  async function approveAll() {
    if (!approveCatId) return;
    setApproveBusy(true);
    setApproveErr(null);
    setApproveDone(null);
    try {
      const r = await fetch("/api/admin/merchants/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: canonicalKey, category_id: approveCatId })
      });
      const j = await safeJson(r);
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erro ${r.status}`);
      const jj = j as { updated: number; status_updated: number };
      setApproveDone(
        `${formatInt(jj.updated)} ${jj.updated === 1 ? "transação categorizada e liberada" : "transações categorizadas e liberadas"} para o portal` +
          (jj.status_updated > 0 ? ` (${formatInt(jj.status_updated)} saíram da fila de revisão)` : "")
      );
      router.refresh();
    } catch (e) {
      setApproveErr((e as Error).message);
    } finally {
      setApproveBusy(false);
    }
  }

  async function runResearch(force: boolean) {
    setResearchBusy(true);
    setResearchErr(null);
    try {
      const r = await fetch(
        `/api/admin/merchants/${encodeURIComponent(canonicalKey)}/research${force ? "?force=1" : ""}`,
        { method: "POST" }
      );
      const j = await safeJson(r);
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erro ${r.status}`);
      const jj = j as { result: { verdict: string; summary: string; cnpj: string | null; cnpj_data: Record<string, string | null> | null; sources: { title: string; url: string }[]; updated_at: string } };
      setResearchResult({
        verdict: jj.result.verdict as ResearchResult["verdict"],
        summary: jj.result.summary,
        cnpj: jj.result.cnpj,
        cnpjData: jj.result.cnpj_data,
        sources: jj.result.sources ?? [],
        updatedAt: jj.result.updated_at
      });
    } catch (e) {
      setResearchErr((e as Error).message);
    } finally {
      setResearchBusy(false);
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
        const j = await safeJson(r);
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

  // Direct merge into a specific cluster — no state dependency.
  // Used by the dropdown click (avoids stale-closure bug with setTimeout + state).
  async function mergeInto(target: ClusterOption) {
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const r = await fetch("/api/admin/merchants/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_canonical_key: canonicalKey,
          target_canonical_key: target.key
        })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      // Navigate to the surviving (target) cluster — it now contains all txs
      router.push(`/admin/merchants/${encodeURIComponent(target.key)}`);
    } catch (e) {
      setRenameErr((e as Error).message);
      setRenameBusy(false);
    }
  }

  // Smart submit from the input field: if nameDraft exactly matches an existing
  // cluster, MERGE. Otherwise RENAME (display name only).
  async function applyRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentName) {
      setEditingName(false);
      return;
    }
    const match = allClusters.find(
      (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (match) {
      await mergeInto(match);
      return;
    }
    // RENAME only
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const r = await fetch("/api/admin/merchants/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: canonicalKey, name: trimmed })
      });
      if (!r.ok) {
        const j = await safeJson(r);
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

  // Toggle a merchant in/out of the multi-merge selection
  function toggleMerge(c: ClusterOption) {
    setSelectedForMerge((prev) => {
      const next = new Map(prev);
      if (next.has(c.key)) next.delete(c.key);
      else next.set(c.key, c);
      return next;
    });
  }

  // Execute multi-merge: pull all selected INTO current, then rename current
  async function executeMultiMerge() {
    if (selectedForMerge.size === 0) return;
    setMultiMergeBusy(true);
    setMultiMergeErr(null);
    setMultiMergeDone(null);
    try {
      for (const [key] of selectedForMerge) {
        const r = await fetch("/api/admin/merchants/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // selected merchant is the SOURCE (gets absorbed), current is the TARGET (survives)
          body: JSON.stringify({
            source_canonical_key: key,
            target_canonical_key: canonicalKey
          })
        });
        if (!r.ok) {
          const j = await safeJson(r);
          const name = selectedForMerge.get(key)?.name ?? key;
          throw new Error(`Erro ao fundir "${name}": ${j.error ?? r.status}`);
        }
      }
      // Rename current to finalName if changed
      const trimmed = finalName.trim();
      if (trimmed && trimmed !== currentName) {
        const r = await fetch("/api/admin/merchants/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canonical_key: canonicalKey, name: trimmed })
        });
        if (!r.ok) {
          const j = await safeJson(r);
          throw new Error(`Erro ao renomear: ${j.error ?? r.status}`);
        }
      }
      const count = selectedForMerge.size;
      setSelectedForMerge(new Map());
      setEditingName(false);
      setDropdownOpen(false);
      setMultiMergeDone(`${count + 1} merchant${count > 0 ? "s" : ""} fundidos com sucesso`);
      router.refresh();
    } catch (e) {
      setMultiMergeErr((e as Error).message);
    } finally {
      setMultiMergeBusy(false);
    }
  }

  // Live-filter clusters by typed text (case-insensitive) for the combobox dropdown
  const matchingSuggestions = (() => {
    const q = nameDraft.trim().toLowerCase();
    if (!q || q === currentName.toLowerCase()) return allClusters.slice(0, 12);
    return allClusters
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 15);
  })();
  const exactMatch = matchingSuggestions.find(
    (c) => c.name.trim().toLowerCase() === nameDraft.trim().toLowerCase()
  );

  async function openInSheets() {
    setSheetsErr(null);
    // Open a new tab immediately (before the async call) so popup blockers
    // don't block it — we navigate it to the sheet URL when ready.
    const newTab = window.open("about:blank", "_blank");
    setSheetsBusy(true);
    try {
      const r = await fetch(
        `/api/admin/merchants/${encodeURIComponent(canonicalKey)}/export-sheet`,
        { method: "POST" }
      );
      const j = await r.json().catch(() => ({ error: `Erro ${r.status}` }));
      if (!r.ok) {
        if (newTab) newTab.close();
        setSheetsErr(
          (j as { needsAuth?: boolean }).needsAuth
            ? "Conta Google não conectada."
            : ((j as { error?: string }).error ?? `Erro ${r.status}`)
        );
        return;
      }
      const url = (j as { url: string }).url;
      if (newTab) newTab.location.href = url;
      else window.open(url, "_blank");
    } catch (e) {
      if (newTab) newTab.close();
      setSheetsErr((e as Error).message);
    } finally {
      setSheetsBusy(false);
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
        const j = await safeJson(r);
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
      {/* ── Nome exibido + Fundir com outros — admin only ────────────────── */}
      {role === "admin" && <section className="mb-5 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
          Nome exibido
        </p>

        {/* View mode */}
        {!editingName ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-base font-semibold text-on-surface truncate">{currentName}</p>
            <button
              onClick={() => {
                setNameDraft(currentName);
                setFinalName(currentName);
                setRenameErr(null);
                setMultiMergeErr(null);
                setMultiMergeDone(null);
                setSelectedForMerge(new Map());
                setDropdownOpen(false);
                setEditingName(true);
                setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 50);
              }}
              className="px-3 py-1.5 rounded-lg text-xs border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition flex items-center gap-1.5"
            >
              <Pencil size={12} /> Renomear
            </button>
            <button
              onClick={() => {
                setNameDraft("");
                setFinalName(currentName);
                setRenameErr(null);
                setMultiMergeErr(null);
                setMultiMergeDone(null);
                setSelectedForMerge(new Map());
                setEditingName(true);
                setDropdownOpen(true);
                setTimeout(() => searchRef.current?.focus(), 50);
              }}
              className="px-3 py-1.5 rounded-lg text-xs border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition flex items-center gap-1.5"
            >
              <GitMerge size={12} /> Fundir com outros
            </button>
          </div>
        ) : (
          <div>
            {/* Search input */}
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  ref={searchRef}
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => { setNameDraft(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setEditingName(false); setSelectedForMerge(new Map()); }
                    if (e.key === "Enter" && selectedForMerge.size === 0) applyRename();
                  }}
                  placeholder="Buscar merchants para selecionar e fundir…"
                  maxLength={120}
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-surface-container border border-outline-variant text-sm outline-none focus:border-primary transition text-on-surface"
                />
              </div>
              {selectedForMerge.size === 0 && (
                <>
                  <button
                    onClick={applyRename}
                    disabled={renameBusy || !nameDraft.trim() || nameDraft.trim() === currentName}
                    className="px-3 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 bg-primary text-on-primary hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {renameBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Renomear
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setSelectedForMerge(new Map()); setDropdownOpen(false); }}
                    className="px-2 py-2 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface transition"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>

            {/* Dropdown with checkboxes */}
            {dropdownOpen && matchingSuggestions.length > 0 && (
              <div className="relative z-20 mb-2">
                <div className="rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow overflow-hidden">
                  <div className="px-3 py-2 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Selecione para fundir (múltiplos)
                    </p>
                    <button
                      onMouseDown={(e) => { e.preventDefault(); setDropdownOpen(false); }}
                      className="text-on-surface-variant hover:text-on-surface p-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <ul className="max-h-56 overflow-y-auto divide-y divide-outline-variant">
                    {matchingSuggestions.map((c) => {
                      const checked = selectedForMerge.has(c.key);
                      return (
                        <li key={c.key}>
                          <label
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition ${
                              checked ? "bg-primary/5" : "hover:bg-surface-container"
                            }`}
                            onMouseDown={(e) => e.preventDefault()} // keep input focused
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                toggleMerge(c);
                                // Pre-fill finalName with current page name if first selection
                                if (!checked && selectedForMerge.size === 0) {
                                  setFinalName(currentName);
                                }
                              }}
                              className="accent-primary w-4 h-4 shrink-0 rounded"
                            />
                            <span className={`text-sm flex-1 truncate ${checked ? "font-semibold text-on-surface" : "text-on-surface"}`}>
                              {c.name}
                            </span>
                            {checked && (
                              <span className="text-[10px] font-bold text-primary uppercase shrink-0">✓ selecionado</span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {nameDraft.trim() && matchingSuggestions.length >= 15 && (
                    <p className="px-3 py-1.5 text-[10px] text-on-surface-variant border-t border-outline-variant">
                      Mostrando 15 primeiros — continue digitando para filtrar
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Confirmation panel — appears when ≥1 selected */}
            {selectedForMerge.size > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 space-y-3">
                {/* Selected chips */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                    {selectedForMerge.size + 1} merchant{selectedForMerge.size > 0 ? "s" : ""} para fundir:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {/* Current merchant (always included, can't be deselected) */}
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary text-on-primary font-medium">
                      {currentName}
                      <span className="opacity-60 text-[10px]">(este)</span>
                    </span>
                    {/* Selected merchants */}
                    {[...selectedForMerge.values()].map((c) => (
                      <span key={c.key} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant text-on-surface font-medium">
                        {c.name}
                        <button
                          onClick={() => toggleMerge(c)}
                          className="text-on-surface-variant hover:text-error ml-0.5"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Final name input */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1.5">
                    Nome final (todos vão usar este nome)
                  </label>
                  <input
                    value={finalName}
                    onChange={(e) => setFinalName(e.target.value)}
                    placeholder="Ex: St Paul's School"
                    maxLength={120}
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant text-sm outline-none focus:border-primary transition text-on-surface"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={executeMultiMerge}
                    disabled={multiMergeBusy || !finalName.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition"
                  >
                    {multiMergeBusy
                      ? <><Loader2 size={14} className="animate-spin" /> Fundindo…</>
                      : <><GitMerge size={14} /> Fundir {selectedForMerge.size + 1} → &quot;{finalName.trim() || "…"}&quot;</>
                    }
                  </button>
                  <button
                    onClick={() => { setSelectedForMerge(new Map()); setEditingName(false); setDropdownOpen(false); }}
                    disabled={multiMergeBusy}
                    className="px-3 py-2.5 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface text-sm transition"
                  >
                    Cancelar
                  </button>
                </div>

                {multiMergeErr && (
                  <p className="text-xs text-error">{multiMergeErr}</p>
                )}
              </div>
            )}

            {/* Rename-only error */}
            {renameErr && <p className="text-xs text-error mt-1.5">{renameErr}</p>}
          </div>
        )}

        {/* Success message */}
        {multiMergeDone && (
          <p className="mt-3 text-xs text-secondary font-medium flex items-center gap-1.5">
            <Check size={13} /> {multiMergeDone}
          </p>
        )}

        {/* Merge history — undo past merges */}
        {mergeHistory.length > 0 && !editingName && (
          <div className="mt-3 pt-3 border-t border-outline-variant">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
              Absorções anteriores
            </p>
            <div className="flex flex-col gap-1.5">
              {mergeHistory.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-surface-container border border-outline-variant">
                  <div className="flex items-center gap-2 min-w-0">
                    <GitMerge size={11} className="text-on-surface-variant shrink-0" />
                    <span className="text-xs text-on-surface font-medium truncate">{m.sourceName}</span>
                    <span className="text-[10px] text-on-surface-variant shrink-0">{formatDate(m.createdAt)}</span>
                  </div>
                  <button
                    onClick={() => undoMerge(m.id)}
                    disabled={undoBusy !== null || !m.hasDescriptions}
                    title={m.hasDescriptions ? `Separar "${m.sourceName}" de volta` : "Merge antigo — histórico de descrições não disponível"}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition
                      ${!m.hasDescriptions
                        ? "border-outline-variant text-on-surface-variant/40 cursor-not-allowed"
                        : undoBusy === m.id
                          ? "border-primary/20 text-primary cursor-wait"
                          : "border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30"}`}
                  >
                    {undoBusy === m.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                    {undoBusy === m.id ? "Desfazendo…" : "Desfazer"}
                  </button>
                </div>
              ))}
            </div>
            {undoDone && <p className="mt-2 text-xs text-secondary font-medium flex items-center gap-1.5"><Check size={12} /> {undoDone}</p>}
            {undoErr && <p className="mt-2 text-xs text-error">{undoErr}</p>}
          </div>
        )}
      </section>}

      {/* ── Pesquisa profunda — CNPJ + busca com IA para comerciante desconhecido ── */}
      {role === "admin" && (
        <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
              <Search size={12} /> O que é esse comerciante?
            </p>
            {researchResult && (
              <button
                onClick={() => runResearch(true)}
                disabled={researchBusy}
                title="Pesquisar de novo"
                className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface transition disabled:opacity-40"
              >
                {researchBusy ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
                Atualizar
              </button>
            )}
          </div>

          {!researchResult && (
            <button
              onClick={() => runResearch(false)}
              disabled={researchBusy}
              className="w-full py-2.5 rounded-xl border border-outline-variant text-sm font-medium flex items-center justify-center gap-2 text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition disabled:opacity-50 disabled:cursor-wait"
            >
              {researchBusy ? <><Loader2 size={14} className="animate-spin" /> Pesquisando (CNPJ + busca na web)…</> : <><Search size={14} /> Pesquisar este comerciante</>}
            </button>
          )}

          {researchResult && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                {researchResult.verdict === "legitimo" ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-secondary/15 text-secondary">
                    <ShieldCheck size={12} /> Legítimo
                  </span>
                ) : researchResult.verdict === "suspeito" ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-danger/15 text-danger">
                    <ShieldAlert size={12} /> Suspeito
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-fg/10 text-muted">
                    <ShieldQuestion size={12} /> Desconhecido
                  </span>
                )}
                <span className="text-[10px] text-muted">{formatDate(researchResult.updatedAt)}</span>
              </div>
              <p className="text-sm text-fg leading-relaxed">{researchResult.summary}</p>
              {researchResult.cnpj && researchResult.cnpjData && (
                <p className="mt-2 text-[11px] text-muted">
                  CNPJ {researchResult.cnpj} — {researchResult.cnpjData.razao_social ?? "?"} ({researchResult.cnpjData.situacao ?? "situação desconhecida"})
                </p>
              )}
              {researchResult.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {researchResult.sources.slice(0, 5).map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] px-2 py-1 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary/30 transition truncate max-w-[160px]"
                    >
                      {s.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {researchErr && <p className="mt-2 text-xs text-danger">{researchErr}</p>}
        </section>
      )}

      {/* ── Aprovar todas — bulk categorize + share + clear review queue ─── */}
      {role === "admin" && (pendingCount > 0 || approveDone) && (
        <section className="mb-5 p-4 rounded-2xl bg-primary/[0.04] border border-primary/20">
          <p className="text-xs uppercase tracking-wider text-primary font-semibold mb-1">
            Aprovar todas
          </p>
          <p className="text-[11px] text-on-surface-variant mb-3">
            {formatInt(pendingCount)} {pendingCount === 1 ? "transação" : "transações"} aguardando revisão.
            Escolha a categoria e aprove tudo de uma vez — libera pro portal da Ayelet e sai da fila &quot;Para revisar&quot;.
          </p>
          <div className="flex gap-2">
            <select
              value={approveCatId}
              onChange={(e) => setApproveCatId(e.target.value)}
              disabled={approveBusy}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant text-sm outline-none focus:border-primary transition text-on-surface disabled:opacity-50"
            >
              <option value="" disabled>Escolher categoria…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={approveAll}
              disabled={approveBusy || !approveCatId}
              className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition whitespace-nowrap shrink-0"
            >
              {approveBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
              Aprovar todas ({formatInt(pendingCount)})
            </button>
          </div>
          {approveErr && <p className="mt-2 text-xs text-error">{approveErr}</p>}
          {approveDone && (
            <p className="mt-2 text-xs text-secondary font-medium flex items-center gap-1.5">
              <Check size={13} /> {approveDone}
            </p>
          )}
        </section>
      )}

      {/* ── Visibilidade no portal Ayelet — admin only ─────────────── */}
      {role === "admin" && <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
        <p className="text-xs uppercase tracking-wider text-muted mb-3 flex items-center gap-2 flex-wrap">
          Portal Ayelet — {formatInt(rows.length)} transações
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
        </p>

        <p className="text-[10px] text-muted mb-2">
          Total visível: <span className="tabular-nums font-medium text-fg">{formatBRL(currentSharedTotal)}</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
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
              <><Eye size={14} /> Mostrar</>
            )}
          </button>
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
              <><EyeOff size={14} /> Ocultar</>
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
      </section>}

      {/* ── Reimbursement tags — admin only ──────────────────────────────── */}
      {role === "admin" && <section className="mb-5 p-4 rounded-2xl bg-card border border-border">
        <p className="text-xs uppercase tracking-wider text-muted mb-2">
          Reembolso (marca essas {formatInt(rows.length)} despesas)
        </p>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => {
            const Icon = t.icon === "shield" ? Shield : t.icon === "briefcase" ? Briefcase : Tag;
            const allTagged = t.appliedCount >= rows.length && rows.length > 0;
            const someTagged = t.appliedCount > 0 && !allTagged;
            const action: "add" | "remove" = allTagged ? "remove" : "add";
            const isBusy = tagBusy === t.slug;
            const colorClasses =
              t.color === "purple"
                ? "border-fuchsia-500/40 text-fuchsia-500 hover:bg-fuchsia-500/5"
                : t.color === "info"
                  ? "border-sky-500/40 text-sky-500 hover:bg-sky-500/5"
                  : t.color === "warning"
                    ? "border-warning/40 text-warning hover:bg-warning/5"
                    : t.color === "danger"
                      ? "border-danger/40 text-danger hover:bg-danger/5"
                      : "border-accent/40 text-accent hover:bg-accent/5";
            const activeClasses =
              t.color === "purple"
                ? "bg-fuchsia-500 text-white border-fuchsia-500"
                : t.color === "info"
                  ? "bg-sky-500 text-white border-sky-500"
                  : t.color === "warning"
                    ? "bg-warning text-bg border-warning"
                    : t.color === "danger"
                      ? "bg-danger text-white border-danger"
                      : "bg-accent text-bg border-accent";
            return (
              <button
                key={t.slug}
                onClick={() => bulkTag(t.slug, action)}
                disabled={isBusy}
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition flex items-center gap-2
                  ${allTagged ? activeClasses : colorClasses}
                  ${isBusy ? "opacity-50 cursor-wait" : "active:scale-[0.99]"}`}
              >
                {isBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Icon size={14} />
                )}
                {t.name}
                {someTagged && (
                  <span className="text-[10px] tabular-nums opacity-70">
                    {formatInt(t.appliedCount)}/{formatInt(rows.length)}
                  </span>
                )}
                {allTagged && (
                  <Check size={12} />
                )}
              </button>
            );
          })}
        </div>
        {tagDone && <p className="mt-2 text-xs text-accent">✅ {tagDone}</p>}
        <p className="mt-2 text-[10px] text-muted">
          Clique pra adicionar tag. Se TODAS já estiverem marcadas, clica de novo pra remover.
          Acompanhe o status em <a href="/admin/reembolsos" className="underline">Reembolsos</a>.
        </p>
      </section>}

      {/* ── Transactions datatable ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Histórico
            <span className="ml-1.5 font-normal normal-case text-on-surface-variant">
              — clique nas colunas para ordenar
            </span>
          </h2>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={openInSheets}
              disabled={sheetsBusy || rows.length === 0}
              title="Criar planilha no Google Sheets com todas as transações"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 text-[11px] font-medium transition disabled:opacity-30"
            >
              {sheetsBusy ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
              {sheetsBusy ? "Gerando…" : "Abrir no Sheets"}
            </button>
            {sheetsErr && (
              <p className="text-[10px] text-danger max-w-[240px] text-right">
                {sheetsErr.includes("Conta Google") ? "Conta Google não conectada — configure em Admin." : sheetsErr}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-bg/70 border-b border-border">
                  <th
                    onClick={() => toggleSort("date")}
                    className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted cursor-pointer select-none hover:text-fg whitespace-nowrap"
                  >
                    <span className="flex items-center gap-1">
                      Data
                      <ArrowUpDown size={10} className={sortBy === "date" ? "text-accent" : "opacity-25"} />
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Descrição</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted hidden md:table-cell">Conta</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted hidden lg:table-cell">Categoria</th>
                  <th
                    onClick={() => toggleSort("amount")}
                    className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted cursor-pointer select-none hover:text-fg whitespace-nowrap"
                  >
                    <span className="flex items-center justify-end gap-1">
                      Valor
                      <ArrowUpDown size={10} className={sortBy === "amount" ? "text-accent" : "opacity-25"} />
                    </span>
                  </th>
                  {role === "admin" && (
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted hidden sm:table-cell whitespace-nowrap">
                      Portal
                    </th>
                  )}
                  {role === "admin" && <th className="px-2 py-2.5 w-24" />}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const effShared = localShared[r.id] ?? r.sharedAmount;
                  const hidden = effShared === 0;
                  const isBusy = rowBusy === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-border last:border-0 transition-colors ${hidden ? "bg-warning/[0.03]" : "hover:bg-surface-container/30"}`}
                    >
                      <td className="px-4 py-3 text-[11px] text-muted tabular-nums whitespace-nowrap align-middle">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <p className="font-medium text-on-surface truncate max-w-[200px]">{r.description}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {hidden && (
                            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-warning/15 text-warning">
                              <EyeOff size={8} /> OCULTO
                            </span>
                          )}
                          <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium lg:hidden ${r.categoryName === "Outros" ? "bg-warning/15 text-warning" : "bg-fg/5 text-muted"}`}>
                            {r.categoryName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted truncate max-w-[120px] hidden md:table-cell align-middle">
                        {r.accountName}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell align-middle">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.categoryName === "Outros" ? "bg-warning/15 text-warning" : "bg-fg/5 text-muted"}`}>
                          {r.categoryName}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold whitespace-nowrap align-middle ${r.amount < 0 ? "text-danger" : "text-accent"}`}>
                        {formatBRL(r.amount)}
                      </td>
                      {role === "admin" && (
                        <td className="px-4 py-3 text-right tabular-nums text-[11px] hidden sm:table-cell align-middle whitespace-nowrap">
                          {hidden
                            ? <span className="text-warning font-medium">Oculto</span>
                            : effShared !== r.amount
                              ? <span className="text-on-surface-variant">{formatBRL(effShared)}</span>
                              : <span className="text-on-surface-variant/40">—</span>}
                        </td>
                      )}
                      {role === "admin" && (
                        <td className="px-2 py-2 align-middle">
                          <div className="flex items-center justify-end gap-1">
                            <MoveDescriptionButton
                              descriptionRaw={r.descriptionRaw}
                              currentName={currentName}
                              allClusters={allClusters}
                            />
                            <ReceiptFinderButton
                              transactionId={r.id}
                              merchantName={currentName}
                              searched={r.gmailSearched}
                              matchCount={r.gmailMatchCount}
                            />
                            <button
                              onClick={() => toggleRowHide(r)}
                              disabled={isBusy}
                              aria-label={hidden ? "Mostrar para Ayelet" : "Esconder do portal"}
                              title={hidden ? "Mostrar para Ayelet" : "Esconder do portal"}
                              className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center transition
                                ${isBusy ? "border-border text-muted cursor-wait"
                                  : hidden ? "border-warning/30 text-warning hover:bg-warning/5"
                                  : "border-border text-muted hover:text-fg hover:border-fg/30"}`}
                            >
                              {isBusy ? <Loader2 size={12} className="animate-spin" />
                                : hidden ? <EyeOff size={12} />
                                : <Eye size={12} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
