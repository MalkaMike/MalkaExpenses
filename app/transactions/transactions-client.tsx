"use client";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { TransactionRow } from "@/components/transaction-row";
import { TransactionEditModal, type EditableTx } from "@/components/transaction-edit-modal";
import { CATEGORY_META, getCategoryTree } from "@/lib/categories/meta";
import type { Role } from "@/lib/auth/admin";

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

function dayHeader(iso: string): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const yIso = y.toISOString().slice(0, 10);
  if (iso === todayIso) return "Hoje";
  if (iso === yIso) return "Ontem";
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
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(initialCat);
  const [accId, setAccId] = useState<string>(initialAccId);
  const [editing, setEditing] = useState<EditableTx | null>(null);

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
            placeholder="buscar..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-card border border-border outline-none text-sm focus:border-accent transition"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
          <FilterSelect
            value={accId}
            onChange={setAccId}
            placeholder="Todas as contas"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
          <GroupedCategorySelect value={cat} onChange={setCat} />
          {anyFilter && (
            <button
              onClick={() => {
                setQ("");
                setCat("");
                setAccId("");
              }}
              className="text-xs text-muted hover:text-fg whitespace-nowrap px-2"
            >
              limpar
            </button>
          )}
        </div>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-2 mb-5 text-sm">
        <div className="p-3 rounded-xl bg-accent/10 border border-accent/20">
          <p className="text-[10px] uppercase tracking-wider text-muted">Receita</p>
          <p className="tabular-nums font-semibold text-accent">
            +{formatBRL(totals.income)}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/20">
          <p className="text-[10px] uppercase tracking-wider text-muted">Despesa</p>
          <p className="tabular-nums font-semibold text-danger">
            -{formatBRL(totals.expense)}
          </p>
        </div>
      </div>

      {/* Grouped list */}
      {grouped.length === 0 && (
        <div className="text-center py-12 text-sm text-muted">
          Nenhum movimento {anyFilter ? "com esses filtros" : ""}.
        </div>
      )}
      <div className="space-y-5">
        {grouped.map(([date, list]) => (
          <div key={date}>
            <h3 className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1">
              {dayHeader(date)}
            </h3>
            <div className="space-y-2">
              {list.map((r) => (
                <button
                  key={r.id}
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
                  className="block w-full text-left"
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
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <TransactionEditModal tx={editing} role={role} onClose={() => setEditing(null)} />
    </>
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
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs px-3 py-1.5 rounded-full bg-card border ${
        value ? "border-accent text-accent" : "border-border text-muted"
      } whitespace-nowrap outline-none`}
    >
      <option value="">Todas as categorias</option>
      {getCategoryTree().map(({ parent, children }) =>
        children.length > 0 ? (
          <optgroup key={parent.slug} label={parent.name}>
            <option value={parent.slug}>{parent.name} (todos)</option>
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
