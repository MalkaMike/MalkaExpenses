"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, Pencil, Plus, X, Loader2, Save } from "lucide-react";
import { getCategoryMeta, getCategoryTree } from "@/lib/categories/meta";
import { formatBRL, formatDate } from "@/lib/format";
import { safeJson } from "@/lib/http";

export type InboxRow = {
  id: string;
  accountName: string;
  date: string;
  description: string;
  amountReal: number;
  isTransfer: boolean;
  categorySlug: string;
};

type Account = { id: string; name: string; bank: string };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InboxClient({ rows: initial, accounts }: { rows: InboxRow[]; accounts: Account[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((r) => [r.id, r.categorySlug]))
  );
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustVal, setAdjustVal] = useState("");
  const [catMap, setCatMap] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState(false);

  const allSelected = selected.size > 0 && selected.size === rows.length;

  async function ensureCatMap() {
    if (catMap) return catMap;
    const j = (await fetch("/api/categories-map").then((r) => r.json())) as Record<string, string>;
    setCatMap(j);
    return j;
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const j = await safeJson(r);
      throw new Error(j.error ?? "erro");
    }
  }

  function drop(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  async function hide(row: InboxRow) {
    setBusy(true);
    try {
      await patch(row.id, { hide: true });
      toast.success("Ocultado do portal");
      drop(row.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyAdjust(row: InboxRow) {
    const n = Number(adjustVal.replace(",", "."));
    if (!Number.isFinite(n)) { toast.error("Valor inválido"); return; }
    const signed = row.amountReal < 0 ? -Math.abs(n) : Math.abs(n);
    setBusy(true);
    try {
      const cmap = await ensureCatMap();
      await patch(row.id, { shared_amount: signed, category_id: cmap[cat[row.id]] ?? undefined });
      toast.success("Ajustado e aceito");
      setAdjustId(null);
      setAdjustVal("");
      drop(row.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <>
      {/* Sticky bulk bar — Stitch top bar style */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur -mx-4 px-4 py-3 mb-5 border-b border-outline-variant">
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              className="accent-primary"
              disabled={rows.length === 0}
            />
            <span className="text-on-surface-variant text-xs font-medium">
              {selected.size > 0 ? `${selected.size} selecionados` : "Selecionar todos"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdding(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant inline-flex items-center gap-1.5 hover:bg-surface-container transition"
            >
              <Plus size={12} /> Adicionar
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 && !adding && (
        <div className="rounded-xl bg-secondary-container/20 border border-secondary-container p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center mx-auto mb-3">
            <Check size={22} className="text-secondary" />
          </div>
          <h2 className="font-semibold text-on-surface mb-1">Tudo em dia</h2>
          <p className="text-sm text-on-surface-variant">Nenhum movimento novo nos últimos 30 dias.</p>
        </div>
      )}

      {/* Transaction list — Stitch card style */}
      {rows.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden soft-ambient-shadow">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              {rows.length} {rows.length !== 1 ? "movimentos" : "movimento"} — últimos 30 dias
            </span>
          </div>

          <ul className="divide-y divide-outline-variant">
            {rows.map((r) => {
              const meta = getCategoryMeta(cat[r.id] ?? r.categorySlug);
              const isSel = selected.has(r.id);
              const income = r.amountReal > 0;
              return (
                <li
                  key={r.id}
                  className={`px-5 py-4 hover:bg-surface-container transition-colors ${isSel ? "bg-primary/[0.03]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(r.id)}
                      className="accent-primary mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {/* Description + amount */}
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <p className="font-semibold text-sm text-on-surface truncate">{r.description}</p>
                        <p
                          className={`tabular-nums font-bold text-sm shrink-0 ${
                            income ? "text-secondary" : "text-on-tertiary-container"
                          }`}
                        >
                          {income ? "+" : "−"}{formatBRL(Math.abs(r.amountReal))}
                        </p>
                      </div>
                      {/* Meta */}
                      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <span className="truncate">{r.accountName}</span>
                        <span>·</span>
                        <span className="shrink-0">{formatDate(r.date)}</span>
                      </div>

                      {/* Category + actions */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={cat[r.id] ?? r.categorySlug}
                          onChange={(e) => setCat((c) => ({ ...c, [r.id]: e.target.value }))}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant outline-none max-w-[150px] focus:border-primary transition"
                          style={{ color: meta.color }}
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
                        </select>

                        {adjustId === r.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={adjustVal}
                              onChange={(e) => setAdjustVal(e.target.value)}
                              placeholder="valor"
                              className="text-xs w-24 px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-primary outline-none tabular-nums"
                            />
                            <button
                              disabled={busy}
                              onClick={() => applyAdjust(r)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-on-primary inline-flex items-center gap-1 disabled:opacity-50 active:scale-95 transition"
                            >
                              <Save size={11} /> OK
                            </button>
                            <button onClick={() => { setAdjustId(null); setAdjustVal(""); }} className="text-on-surface-variant p-1">
                              <X size={12} />
                            </button>
                          </span>
                        ) : (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => { setAdjustId(r.id); setAdjustVal(String(Math.abs(r.amountReal))); }}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-container border border-outline-variant inline-flex items-center gap-1.5 hover:bg-surface-container-high disabled:opacity-50 transition text-on-surface"
                            >
                              <Pencil size={11} /> Ajustar
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => hide(r)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-container border border-outline-variant text-on-surface-variant inline-flex items-center gap-1.5 hover:text-error hover:border-error/40 disabled:opacity-50 transition"
                            >
                              <EyeOff size={11} /> Ocultar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {adding && (
        <AddEntry
          accounts={accounts}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function AddEntry({
  accounts, onClose, onCreated
}: { accounts: Account[]; onClose: () => void; onCreated: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"despesa" | "receita">("despesa");
  const [slug, setSlug] = useState("outros");
  const [isFake, setIsFake] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(amount.replace(",", "."));
    if (!accountId || !description.trim() || !Number.isFinite(n) || n <= 0) {
      toast.error("Preencha conta, descrição e valor");
      return;
    }
    const shared = kind === "despesa" ? -Math.abs(n) : Math.abs(n);
    setBusy(true);
    try {
      const r = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, date, description: description.trim(), shared_amount: shared, category_slug: slug, is_fake: isFake })
      });
      if (!r.ok) {
        const j = await safeJson(r);
        toast.error(j.error ?? "erro ao criar");
        return;
      }
      toast.success("Entrada adicionada ao portal");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-surface-container-lowest border-t sm:border border-outline-variant p-5 space-y-3 max-h-[92vh] overflow-y-auto soft-ambient-shadow">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-on-surface">Adicionar entrada</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container transition">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-on-surface-variant">
          Cria um movimento que aparece no portal. Marque &ldquo;fictício&rdquo; para algo que não existe no ledger real.
        </p>

        <Field label="Conta">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="inp">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipo">
            <select value={kind} onChange={(e) => setKind(e.target.value as "despesa" | "receita")} className="inp">
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
            </select>
          </Field>
          <Field label="Valor (R$)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="inp tabular-nums" />
          </Field>
        </div>

        <Field label="Descrição">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="inp" />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Categoria">
            <select value={slug} onChange={(e) => setSlug(e.target.value)} className="inp">
              {getCategoryTree().map(({ parent, children }) =>
                children.length > 0 ? (
                  <optgroup key={parent.slug} label={parent.name}>
                    <option value={parent.slug}>{parent.name} (geral)</option>
                    {children.map((c) => <option key={c.slug} value={c.slug}>{"  "}{c.name}</option>)}
                  </optgroup>
                ) : (
                  <option key={parent.slug} value={parent.slug}>{parent.name}</option>
                )
              )}
            </select>
          </Field>
          <Field label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer text-on-surface">
          <input type="checkbox" checked={isFake} onChange={(e) => setIsFake(e.target.checked)} className="accent-primary" />
          Entrada fictícia (real_amount = 0)
        </label>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full p-3 rounded-xl bg-primary text-on-primary font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Adicionar ao portal
        </button>

        <style jsx global>{`
          .inp { width:100%; padding:0.625rem 0.75rem; border-radius:0.5rem; background:#f5f3f0; border:1px solid #c6c6cd; color:#1b1c1a; font-size:0.875rem; outline:none; }
          .inp:focus { border-color:#000000; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">{label}</span>
      {children}
    </label>
  );
}
