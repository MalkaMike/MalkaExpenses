"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, Pencil, Plus, X, Loader2, Save } from "lucide-react";
import { getCategoryMeta, getCategoryTree } from "@/lib/categories/meta";
import { formatBRL, formatDate } from "@/lib/format";

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
      const j = await r.json().catch(() => ({}));
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

  // Accept → show the full real amount in the portal, with the chosen category.
  async function accept(row: InboxRow) {
    setBusy(true);
    try {
      const cmap = await ensureCatMap();
      await patch(row.id, {
        shared_amount: row.amountReal,
        category_id: cmap[cat[row.id]] ?? undefined
      });
      toast.success("Aceito — visível no portal");
      drop(row.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Hide → stays real-only, never shown to the household.
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

  // Adjust → show a custom amount (keeps the sign of the real value).
  async function applyAdjust(row: InboxRow) {
    const n = Number(adjustVal.replace(",", "."));
    if (!Number.isFinite(n)) {
      toast.error("Valor inválido");
      return;
    }
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

  async function bulkAccept() {
    if (selected.size === 0) return;
    setBusy(true);
    let ok = 0;
    try {
      const cmap = await ensureCatMap();
      for (const id of selected) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        try {
          await patch(id, {
            shared_amount: row.amountReal,
            category_id: cmap[cat[id]] ?? undefined
          });
          ok++;
        } catch {
          /* counted via ok */
        }
      }
      toast.success(`${ok} aceitos`);
      setRows((rs) => rs.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
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
      {/* Bulk bar */}
      <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur -mx-4 px-4 py-3 mb-4 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              className="accent-accent"
              disabled={rows.length === 0}
            />
            <span className="text-muted">
              {selected.size > 0 ? `${selected.size} selecionados` : "selecionar todos"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                disabled={busy}
                onClick={bulkAccept}
                className="text-xs px-3 py-1.5 rounded-full bg-accent text-white font-medium disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Check size={12} /> aceitar selecionados
              </button>
            )}
            <button
              onClick={() => setAdding(true)}
              className="text-xs px-3 py-1.5 rounded-full bg-card border border-border inline-flex items-center gap-1 hover:border-accent/40"
            >
              <Plus size={12} /> adicionar
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 && !adding && (
        <div className="rounded-2xl bg-accent/10 border border-accent/30 p-8 text-center">
          <Check size={32} className="mx-auto text-accent mb-2" />
          <h2 className="font-medium mb-1">Tudo decidido</h2>
          <p className="text-sm text-muted">Nada aguardando no momento.</p>
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((r) => {
          const meta = getCategoryMeta(cat[r.id] ?? r.categorySlug);
          const isSel = selected.has(r.id);
          const income = r.amountReal > 0;
          return (
            <li
              key={r.id}
              className={`rounded-xl border p-3 transition ${isSel ? "border-accent bg-accent/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(r.id)}
                  className="accent-accent shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{r.description}</p>
                    <p className={`tabular-nums font-semibold shrink-0 ${income ? "text-accent" : ""}`}>
                      {income ? "+" : "−"}
                      {formatBRL(Math.abs(r.amountReal))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                    <span className="truncate">{r.accountName}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatDate(r.date)}</span>
                  </div>
                </div>
              </div>

              {/* Category + actions */}
              <div className="mt-2.5 pl-7 flex flex-wrap items-center gap-2">
                <select
                  value={cat[r.id] ?? r.categorySlug}
                  onChange={(e) => setCat((c) => ({ ...c, [r.id]: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded-lg bg-bg border border-border outline-none max-w-[160px]"
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
                  <span className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={adjustVal}
                      onChange={(e) => setAdjustVal(e.target.value)}
                      placeholder="valor mostrado"
                      className="text-xs w-28 px-2 py-1.5 rounded-lg bg-bg border border-accent outline-none tabular-nums"
                    />
                    <button
                      disabled={busy}
                      onClick={() => applyAdjust(r)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-accent text-white inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Save size={11} /> ok
                    </button>
                    <button onClick={() => { setAdjustId(null); setAdjustVal(""); }} className="text-muted p-1">
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => accept(r)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-accent text-white font-medium inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Check size={12} /> aceitar
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => { setAdjustId(r.id); setAdjustVal(String(Math.abs(r.amountReal))); }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-card border border-border inline-flex items-center gap-1 hover:border-fg/40 disabled:opacity-50"
                    >
                      <Pencil size={11} /> ajustar
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => hide(r)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted inline-flex items-center gap-1 hover:text-danger hover:border-danger/40 disabled:opacity-50"
                    >
                      <EyeOff size={11} /> ocultar
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {adding && (
        <AddEntry
          accounts={accounts}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function AddEntry({
  accounts,
  onClose,
  onCreated
}: {
  accounts: Account[];
  onClose: () => void;
  onCreated: () => void;
}) {
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
        body: JSON.stringify({
          account_id: accountId,
          date,
          description: description.trim(),
          shared_amount: shared,
          category_slug: slug,
          is_fake: isFake
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Adicionar entrada</h3>
          <button onClick={onClose} className="text-muted hover:text-fg"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted">
          Cria um movimento que aparece no portal. Marque “entrada fictícia” para
          algo que não existe no ledger real.
        </p>

        <Field label="Conta">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="inp">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
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
                    {children.map((c) => (
                      <option key={c.slug} value={c.slug}>{"  "}{c.name}</option>
                    ))}
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

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isFake} onChange={(e) => setIsFake(e.target.checked)} className="accent-accent" />
          Entrada fictícia (real_amount = 0)
        </label>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full p-3 rounded-xl bg-accent text-white font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Adicionar ao portal
        </button>

        <style jsx global>{`
          .inp { width: 100%; padding: 0.625rem 0.75rem; border-radius: 0.75rem; background: rgb(var(--bg)); border: 1px solid rgb(var(--border)); color: rgb(var(--fg)); font-size: 0.875rem; outline: none; }
          .inp:focus { border-color: rgb(var(--accent)); }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
