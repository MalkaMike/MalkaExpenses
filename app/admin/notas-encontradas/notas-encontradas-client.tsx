"use client";
import { useState } from "react";
import {
  Check, X, ExternalLink, Paperclip, ShieldCheck, FileText, Loader2, Inbox, CheckCheck,
  Briefcase, Shield, Tag, ChevronRight, Pencil, CheckCheck as CheckCheckIcon
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";
import { safeJson } from "@/lib/http";

// ── Shared types (also imported by the server page) ─────────────────────────

export type Category = {
  id: string;
  name: string;
  slug: string;
};

export type ReimbursementTag = {
  id: string;
  slug: string;   // 'kenlo' | 'laik' | 'insurance'
  name: string;
  color: string;  // 'accent' | 'info' | 'purple' | 'fg' | ...
  icon: string;   // 'briefcase' | 'shield' | 'tag'
};

export type FoundReceipt = {
  receiptId: string;
  gmailUrl: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  sentAt: string | null;
  hasAttachment: boolean;
  attachmentCount: number;
  confidence: string; // "verified" | "high"
  matchSource: string | null;
  matchSnippet: string | null;
  amountBrl: number | null;
  foundAt: string;
  txId: string;
  txDate: string;
  merchantName: string;
  merchantKey: string;  // canonical_key — used for category changes + merchant page link
  txAmount: number;
  accountName: string;
  categoryId: string | null;  // current category from merchant_clusters
};

export type DayGroup = { day: string; items: FoundReceipt[] };

// ── Reimbursement tag color map ──────────────────────────────────────────────
const tagColorMap: Record<string, { base: string; selected: string }> = {
  accent:  { base: "border-primary/30 text-primary",            selected: "bg-primary text-on-primary border-primary" },
  info:    { base: "border-sky-400/40 text-sky-600",             selected: "bg-sky-500 text-white border-sky-500" },
  purple:  { base: "border-purple-400/40 text-purple-600",       selected: "bg-purple-500 text-white border-purple-500" },
  warning: { base: "border-amber-400/40 text-amber-600",         selected: "bg-amber-500 text-white border-amber-500" },
  fg:      { base: "border-outline-variant text-on-surface-variant", selected: "bg-on-surface text-surface border-on-surface" },
};
const tagColors = (color: string, selected: boolean) => {
  const c = tagColorMap[color] ?? tagColorMap.fg;
  return selected ? c.selected : c.base;
};

const TagIcon = ({ icon, size = 10 }: { icon: string; size?: number }) => {
  if (icon === "briefcase") return <Briefcase size={size} />;
  if (icon === "shield")    return <Shield size={size} />;
  return <Tag size={size} />;
};

const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${day} de ${months[(m ?? 1) - 1]} de ${y}`;
};

// ── Category picker component ────────────────────────────────────────────────
// Shows the current category as a chip. Click the pencil to open an inline
// <select>. On change → calls bulk_categorize_merchant (propagates to ALL
// past + future transactions of that merchant).
function CategoryPicker({
  merchantKey,
  merchantName,
  currentCategoryId,
  categories,
  onSaved
}: {
  merchantKey: string;
  merchantName: string;
  currentCategoryId: string | null;
  categories: Category[];
  onSaved: (merchantKey: string, categoryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const current = categories.find((c) => c.id === currentCategoryId);

  async function handleChange(categoryId: string) {
    if (!categoryId) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/merchants/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_key: merchantKey, category_id: categoryId })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      onSaved(merchantKey, categoryId);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <select
          autoFocus
          defaultValue={currentCategoryId ?? ""}
          onChange={(e) => { if (e.target.value) handleChange(e.target.value); }}
          onBlur={() => { if (!saving) setEditing(false); }}
          disabled={saving}
          className="text-[11px] rounded-lg border border-primary/40 bg-surface px-2 py-1 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary flex-1 min-w-0 disabled:opacity-50"
        >
          <option value="" disabled>Escolher categoria…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {saving && <Loader2 size={11} className="animate-spin text-primary shrink-0" />}
        <button
          onClick={() => setEditing(false)}
          className="text-on-surface-variant hover:text-on-surface transition shrink-0"
          title="Cancelar"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-1">
      {current ? (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant truncate max-w-[140px]">
          {current.name}
        </span>
      ) : (
        <span className="text-[10px] text-on-surface-variant/60 italic">Sem categoria</span>
      )}
      {saved ? (
        <span className="text-[10px] text-secondary flex items-center gap-0.5 shrink-0">
          <Check size={10} /> Salvo p/ todos
        </span>
      ) : (
        <button
          onClick={() => setEditing(true)}
          title="Mudar categoria (aplica a todos os movimentos deste fornecedor)"
          className="text-on-surface-variant/50 hover:text-primary transition shrink-0"
        >
          <Pencil size={11} />
        </button>
      )}
      {err && <span className="text-[10px] text-error ml-1">{err}</span>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function NotasEncontradasClient({
  groups,
  reimbursementTags,
  categories
}: {
  groups: DayGroup[];
  reimbursementTags: ReimbursementTag[];
  categories: Category[];
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Per-receipt selected reimbursement tag slug.
  const [selectedTags, setSelectedTags] = useState<Map<string, string>>(new Map());
  // When category changes for a merchant, all cards for that merchant update.
  // Map: merchantKey → categoryId
  const [categoryOverrides, setCategoryOverrides] = useState<Map<string, string>>(new Map());

  function toggleTag(receiptId: string, slug: string) {
    setSelectedTags((prev) => {
      const next = new Map(prev);
      next.get(receiptId) === slug ? next.delete(receiptId) : next.set(receiptId, slug);
      return next;
    });
  }

  function handleCategorySaved(merchantKey: string, categoryId: string) {
    setCategoryOverrides((prev) => new Map(prev).set(merchantKey, categoryId));
  }

  function markDone(ids: string[]) {
    setDone((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setSelectedTags((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function setRowBusy(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function triage(receiptId: string, confirmed: boolean, tagSlug?: string) {
    setErr(null);
    setRowBusy(receiptId, true);
    try {
      const body: Record<string, unknown> = { receipt_id: receiptId, confirmed };
      if (confirmed && tagSlug) body.reimbursement_tag_slug = tagSlug;
      const r = await fetch("/api/admin/gmail/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      markDone([receiptId]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRowBusy(receiptId, false);
    }
  }

  async function acceptDay(day: string, ids: string[]) {
    setErr(null);
    setBulkBusy(day);
    try {
      const r = await fetch("/api/admin/gmail/confirm-receipt/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_ids: ids, confirmed: true })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j.error ?? `Erro ${r.status}`);
      }
      markDone(ids);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  const visibleGroups = groups
    .map((g) => ({ day: g.day, items: g.items.filter((it) => !done.has(it.receiptId)) }))
    .filter((g) => g.items.length > 0);

  const totalVisible = visibleGroups.reduce((s, g) => s + g.items.length, 0);

  if (totalVisible === 0) {
    return (
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-10 text-center">
        <Inbox size={28} className="mx-auto text-on-surface-variant/40" strokeWidth={1.5} />
        <p className="text-sm font-medium text-on-surface mt-3">Tudo revisado 🎉</p>
        <p className="text-xs text-on-surface-variant mt-1">
          Nenhuma nota fiscal nova pra revisar. O robô avisa aqui quando achar mais.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {err && (
        <div className="px-4 py-2.5 rounded-xl bg-error-container/40 border border-error text-sm text-on-error-container">
          {err}
        </div>
      )}

      {visibleGroups.map((g) => (
        <section key={g.day}>
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {dayLabel(g.day)} · {g.items.length} {g.items.length === 1 ? "nota" : "notas"}
            </h2>
            <button
              onClick={() => acceptDay(g.day, g.items.map((it) => it.receiptId))}
              disabled={bulkBusy === g.day}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-secondary/40 text-secondary hover:bg-secondary/5 text-[11px] font-medium transition disabled:opacity-40"
            >
              {bulkBusy === g.day ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
              Aceitar todas ({g.items.length})
            </button>
          </div>

          <ul className="space-y-2">
            {g.items.map((it) => {
              const isVerified = it.confidence === "verified";
              const rowBusy = busy.has(it.receiptId);
              const selectedTag = selectedTags.get(it.receiptId);
              // Use category override if admin changed it this session, else fall back to DB value.
              const effectiveCategoryId = categoryOverrides.get(it.merchantKey) ?? it.categoryId;

              return (
                <li
                  key={it.receiptId}
                  className="rounded-xl border border-outline-variant bg-surface-container-lowest soft-ambient-shadow overflow-hidden"
                >
                  <div className="p-3.5">
                    {/* Merchant + category row */}
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="min-w-0 flex-1">
                        {/* Merchant name + merchant page link */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-sm font-semibold text-on-surface truncate">{it.merchantName}</p>
                          <a
                            href={`/admin/merchants/${it.merchantKey}`}
                            title="Ver detalhes do merchant (fundir, renomear, etc.)"
                            className="text-on-surface-variant/40 hover:text-primary transition shrink-0"
                          >
                            <ChevronRight size={13} />
                          </a>
                        </div>
                        {/* Category picker — changing it here applies to ALL transactions of this merchant */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-on-surface-variant shrink-0">Categoria:</span>
                          <CategoryPicker
                            merchantKey={it.merchantKey}
                            merchantName={it.merchantName}
                            currentCategoryId={effectiveCategoryId}
                            categories={categories}
                            onSaved={handleCategorySaved}
                          />
                        </div>
                        <p className="text-[11px] text-on-surface-variant mt-0.5">
                          {formatDate(it.txDate)} · {it.accountName}
                        </p>
                      </div>
                      <span
                        className={`tabular-nums font-semibold shrink-0 text-sm ${
                          it.txAmount < 0 ? "text-on-tertiary-container" : "text-secondary"
                        }`}
                      >
                        {formatBRL(it.txAmount)}
                      </span>
                    </div>

                    {/* Gmail receipt card */}
                    <div className="rounded-lg bg-surface-container border border-outline-variant/60 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                            isVerified ? "bg-secondary text-on-secondary" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {isVerified ? <ShieldCheck size={10} /> : <FileText size={10} />}
                          {isVerified ? "Valor no anexo" : "Valor no email"}
                        </span>
                        {it.hasAttachment && (
                          <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                            <Paperclip size={10} /> {it.attachmentCount}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] font-medium text-on-surface line-clamp-2">{it.subject}</p>
                      <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                        {it.fromName || it.fromEmail}
                        {it.sentAt ? ` · ${formatDate(it.sentAt.slice(0, 10))}` : ""}
                      </p>
                      {it.matchSnippet && (
                        <p className="text-[11px] text-on-surface italic mt-1.5 line-clamp-2 leading-relaxed">
                          {it.matchSnippet}
                        </p>
                      )}
                    </div>

                    {/* Reimbursement tag picker */}
                    {reimbursementTags.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                        <span className="text-[10px] text-on-surface-variant mr-0.5">Reembolso:</span>
                        {reimbursementTags.map((tag) => {
                          const isSelected = selectedTag === tag.slug;
                          return (
                            <button
                              key={tag.slug}
                              onClick={() => toggleTag(it.receiptId, tag.slug)}
                              disabled={rowBusy}
                              title={isSelected ? `Remover tag ${tag.name}` : `Marcar para reembolso: ${tag.name}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold transition disabled:opacity-40 ${tagColors(tag.color, isSelected)}`}
                            >
                              <TagIcon icon={tag.icon} size={9} />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <a
                        href={it.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-primary/30 text-[11px] font-medium flex items-center gap-1.5 transition"
                      >
                        <ExternalLink size={11} /> Abrir no Gmail
                      </a>
                      <div className="flex-1" />
                      <button
                        onClick={() => triage(it.receiptId, false)}
                        disabled={rowBusy}
                        title="Não é esta nota"
                        className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-error hover:border-error/40 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-40"
                      >
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        Descartar
                      </button>
                      <button
                        onClick={() => triage(it.receiptId, true, selectedTag)}
                        disabled={rowBusy}
                        title={selectedTag ? `Aceitar e marcar reembolso ${selectedTag}` : "Esta é a nota fiscal correta"}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition disabled:opacity-40 ${
                          selectedTag
                            ? "bg-secondary/80 text-on-secondary ring-2 ring-secondary/30 hover:bg-secondary"
                            : "bg-secondary text-on-secondary hover:opacity-85"
                        }`}
                      >
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {selectedTag ? "Aceitar + Reembolso" : "Aceitar"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
