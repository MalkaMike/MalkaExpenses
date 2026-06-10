"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, X, TrendingUp, TrendingDown, EyeOff, Undo2, Loader2 } from "lucide-react";
import { TransactionRow } from "@/components/transaction-row";
import { TransactionEditModal, type EditableTx } from "@/components/transaction-edit-modal";
import { CategoryChip } from "@/components/category-chip";
import { DataTable, type Column } from "@/components/data-table";
import { CATEGORY_META, getCategoryTree } from "@/lib/categories/meta";
import type { Role } from "@/lib/auth/admin";
import { useLang } from "@/lib/i18n/context";
import { t, type Lang } from "@/lib/i18n/translations";
import { safeJson } from "@/lib/http";

type Row = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amountShared: number;
  amountReal: number | null;
  categorySlug: string | null;
  isFake: boolean;
  isTransfer: boolean;
};

function dayHeader(iso: string, lang: Lang): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const yIso = y.toISOString().slice(0, 10);
  if (iso === todayIso) return t("tx.today", lang);
  if (iso === yIso) return t("tx.yesterday", lang);
  const [yyyy, mm, dd] = iso.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${dd} ${months[Number(mm) - 1]} ${yyyy}`;
}

export function TransactionsClient({
  rows,
  accounts,
  role,
  initialAccId = "",
  initialCat = ""
}: {
  rows: Row[];
  accounts: Array<{ id: string; name: string }>;
  role: Role;
  initialAccId?: string;
  initialCat?: string;
}) {
  const { lang } = useLang();
  const router = useRouter();
  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(initialCat);
  const [accId, setAccId] = useState<string>(initialAccId);
  const [editing, setEditing] = useState<EditableTx | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // One-tap take-out (hide) / bring-back (unhide) from the list — admin only.
  // Hidden rows go to the Archive (shared_amount=0); nothing is deleted.
  async function quickToggleHide(r: Row) {
    const hiding = r.amountShared !== 0;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/transactions/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hide: hiding })
      });
      if (!res.ok) {
        const j = await safeJson(res);
        toast.error(j.error ?? "erro");
        return;
      }
      if (hiding) {
        toast.success("Tirado do portal — guardado no Arquivo", {
          action: {
            label: "Desfazer",
            onClick: async () => {
              await fetch(`/api/transactions/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hide: false })
              });
              router.refresh();
            }
          }
        });
      } else {
        toast.success("Trazido de volta ao portal");
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat) {
        const rowSlug = r.categorySlug ?? "outros";
        const rowMeta = CATEGORY_META[rowSlug];
        // Match exact slug OR the row's parent matches (e.g. filter="transporte" matches "combustivel")
        const rowParent = rowMeta?.parentSlug ?? rowSlug;
        if (rowSlug !== cat && rowParent !== cat) return false;
      }
      if (accId && r.account_id !== accId) return false;
      if (qLower && !r.description.toLowerCase().includes(qLower)) return false;
      return true;
    });
  }, [rows, q, cat, accId]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = map.get(r.date) ?? [];
      arr.push(r);
      map.set(r.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of filtered) {
      if (r.isTransfer) continue;
      if (r.amountShared > 0) income += r.amountShared;
      else expense += -r.amountShared;
    }
    return { income, expense };
  }, [filtered]);

  const anyFilter = !!q || !!cat || !!accId;

  return (
    <>
      {/* Search + filters */}
      <div className="space-y-2.5 mb-5">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("tx.search_ph", lang)}
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-card border border-border outline-none text-sm focus:border-accent transition"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              aria-label={t("tx.clear_search", lang)}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
          <FilterSelect
            value={accId}
            onChange={setAccId}
            placeholder={t("tx.all_accounts", lang)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
          <GroupedCategorySelect value={cat} onChange={setCat} lang={lang} />
          {anyFilter && (
            <button
              onClick={() => {
                setQ("");
                setCat("");
                setAccId("");
              }}
              className="text-xs text-muted hover:text-fg whitespace-nowrap px-2"
            >
              {t("tx.clear", lang)}
            </button>
          )}
        </div>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="w-9 h-9 rounded-xl bg-accent/10 inline-flex items-center justify-center mb-2">
            <TrendingUp size={16} className="text-accent" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted">{t("tx.income", lang)}</p>
          <p className="text-xl font-semibold tabular-nums text-accent">
            {formatBRL(totals.income)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="w-9 h-9 rounded-xl bg-danger/10 inline-flex items-center justify-center mb-2">
            <TrendingDown size={16} className="text-danger" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted">{t("tx.expense", lang)}</p>
          <p className="text-xl font-semibold tabular-nums text-danger">
            {formatBRL(totals.expense)}
          </p>
        </div>
      </div>

      {/* Empty state (shared by both layouts) */}
      {grouped.length === 0 && (
        <div className="text-center py-12 text-sm text-muted">
          {anyFilter ? t("tx.empty_filtered", lang) : `${t("tx.empty", lang)}.`}
        </div>
      )}

      {/* Desktop: sortable datatable. Mobile keeps the date-grouped cards below
          — Ayelet's phone flow is untouched (breakpoint split, not replacement). */}
      {filtered.length > 0 && (
        <div className="hidden md:block">
          <DesktopTable
            rows={filtered}
            role={role}
            accountMap={accountMap}
            busyId={busyId}
            onEdit={(r) =>
              setEditing({
                id: r.id,
                date: r.date,
                description: r.description,
                amountShared: r.amountShared,
                amountReal: r.amountReal,
                categorySlug: r.categorySlug,
                isFake: r.isFake,
                isTransfer: r.isTransfer
              })
            }
            onToggleHide={quickToggleHide}
          />
        </div>
      )}

      {/* Mobile: date-grouped cards */}
      <div className="space-y-5 md:hidden">
        {grouped.map(([date, list]) => (
          <div key={date}>
            <h3 className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1">
              {dayHeader(date, lang)}
            </h3>
            <div className="space-y-2">
              {list.map((r) => (
                <div key={r.id} className="flex items-stretch gap-2">
                  <button
                    onClick={() =>
                      setEditing({
                        id: r.id,
                        date: r.date,
                        description: r.description,
                        amountShared: r.amountShared,
                        amountReal: r.amountReal,
                        categorySlug: r.categorySlug,
                        isFake: r.isFake,
                        isTransfer: r.isTransfer
                      })
                    }
                    className="block flex-1 min-w-0 text-left"
                  >
                    <TransactionRow
                      id={r.id}
                      date={r.date}
                      description={r.description}
                      amountShared={r.amountShared}
                      amountReal={r.amountReal}
                      categorySlug={r.categorySlug}
                      isFake={r.isFake}
                      isTransfer={r.isTransfer}
                      role={role}
                      showDate={false}
                      accountName={accountMap.get(r.account_id)}
                    />
                  </button>
                  {role === "admin" && (
                    <button
                      onClick={() => quickToggleHide(r)}
                      disabled={busyId === r.id}
                      title={r.amountShared === 0 ? "Trazer de volta ao portal" : "Tirar do portal"}
                      aria-label={r.amountShared === 0 ? "Trazer de volta" : "Tirar do portal"}
                      className={`shrink-0 w-11 rounded-xl border inline-flex items-center justify-center transition disabled:opacity-50 ${
                        r.amountShared === 0
                          ? "border-accent/30 text-accent bg-accent/5 hover:bg-accent/10"
                          : "border-border bg-card text-muted hover:text-danger hover:border-danger/40"
                      }`}
                    >
                      {busyId === r.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : r.amountShared === 0 ? (
                        <Undo2 size={16} />
                      ) : (
                        <EyeOff size={16} />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <TransactionEditModal tx={editing} role={role} onClose={() => setEditing(null)} />
    </>
  );
}

// Desktop-only sortable table view of the same filtered rows. Row click opens
// the same edit modal as the mobile cards; the trailing column keeps the
// admin-only quick hide/unhide action.
function DesktopTable({
  rows,
  role,
  accountMap,
  busyId,
  onEdit,
  onToggleHide
}: {
  rows: Row[];
  role: Role;
  accountMap: Map<string, string>;
  busyId: string | null;
  onEdit: (r: Row) => void;
  onToggleHide: (r: Row) => void;
}) {
  const { lang } = useLang();
  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Data",
      sortValue: (r) => r.date,
      cell: (r) => (
        <span className="text-[11px] text-muted whitespace-nowrap">{dayHeader(r.date, lang)}</span>
      )
    },
    {
      key: "description",
      header: "Descrição",
      sortValue: (r) => r.description.toLowerCase(),
      cell: (r) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm truncate max-w-[280px]" title={r.description}>
            {r.description}
          </span>
          {r.isTransfer && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-fg/5 text-muted shrink-0">TRANSF</span>
          )}
          {role === "admin" && r.amountShared === 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-warning/15 text-warning shrink-0">OCULTA</span>
          )}
        </span>
      )
    },
    {
      key: "account",
      header: "Conta",
      hideBelow: "lg",
      sortValue: (r) => accountMap.get(r.account_id) ?? "",
      cell: (r) => (
        <span className="text-[11px] text-muted truncate max-w-[140px] block">
          {accountMap.get(r.account_id) ?? "—"}
        </span>
      )
    },
    {
      key: "category",
      header: "Categoria",
      sortValue: (r) => r.categorySlug ?? "outros",
      cell: (r) => <CategoryChip slug={r.categorySlug} size="sm" />
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      sortValue: (r) => r.amountShared,
      cell: (r) => (
        <span
          className={`tabular-nums text-sm font-medium whitespace-nowrap ${
            r.amountShared > 0 ? "text-accent" : r.amountShared === 0 ? "text-muted" : "text-fg"
          }`}
        >
          {formatBRL(r.amountShared)}
        </span>
      )
    }
  ];

  if (role === "admin") {
    columns.push({
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleHide(r);
          }}
          disabled={busyId === r.id}
          title={r.amountShared === 0 ? "Trazer de volta ao portal" : "Tirar do portal"}
          aria-label={r.amountShared === 0 ? "Trazer de volta" : "Tirar do portal"}
          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition disabled:opacity-50 ${
            r.amountShared === 0
              ? "border-accent/30 text-accent bg-accent/5 hover:bg-accent/10"
              : "border-border text-muted hover:text-danger hover:border-danger/40"
          }`}
        >
          {busyId === r.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : r.amountShared === 0 ? (
            <Undo2 size={14} />
          ) : (
            <EyeOff size={14} />
          )}
        </button>
      )
    });
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      defaultSort={{ key: "date", dir: "desc" }}
      onRowClick={onEdit}
    />
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs px-3 py-1.5 rounded-full bg-card border ${
        value ? "border-accent text-accent" : "border-border text-muted"
      } whitespace-nowrap outline-none`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Grouped category picker: parents as optgroups, subcategories as options
function GroupedCategorySelect({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs px-3 py-1.5 rounded-full bg-card border ${
        value ? "border-accent text-accent" : "border-border text-muted"
      } whitespace-nowrap outline-none`}
    >
      <option value="">{t("tx.all_categories", lang)}</option>
      {getCategoryTree().map(({ parent, children }) =>
        children.length > 0 ? (
          <optgroup key={parent.slug} label={parent.name}>
            <option value={parent.slug}>{parent.name} {t("tx.all_suffix", lang)}</option>
            {children.map((c) => (
              <option key={c.slug} value={c.slug}>
                {"  "}{c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={parent.slug} value={parent.slug}>
            {parent.name}
          </option>
        )
      )}
    </select>
  );
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
