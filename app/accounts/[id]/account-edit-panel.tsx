"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Loader2, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { t, type StringKey } from "@/lib/i18n/translations";

const BANKS = ["itau", "bradesco", "santander", "nubank", "inter", "btg", "c6", "outro"];
const TYPE_VALUES = ["checking", "savings", "credit_card"] as const;
const TYPE_LABEL_KEY: Record<string, StringKey> = {
  checking: "acct_type.checking_full",
  savings: "acct_type.savings_full",
  credit_card: "acct_type.credit_card_full"
};

type Account = {
  id: string;
  name: string;
  bank: string;
  type: string;
  real_starting_balance: number;
  shared_starting_balance: number;
  cc_issuer: string | null;
};

export function AccountEditPanel({ account }: { account: Account }) {
  const router = useRouter();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState(account.bank);
  const [type, setType] = useState(account.type);
  const [ccIssuer, setCcIssuer] = useState(account.cc_issuer ?? "");
  const [realStart, setRealStart] = useState(String(account.real_starting_balance));
  const [sharedStart, setSharedStart] = useState(String(account.shared_starting_balance));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          bank,
          type,
          cc_issuer: type === "credit_card" ? ccIssuer || null : null,
          real_starting_balance: Number(realStart.replace(",", ".")) || 0,
          shared_starting_balance: Number(sharedStart.replace(",", ".")) || 0
        })
      });
      if (!r.ok) {
        setErr((await r.json()).error ?? "erro ao salvar");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      if (!r.ok) {
        setErr((await r.json()).error ?? "erro ao arquivar");
        setBusy(false);
        return;
      }
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Edit trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-xl text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border transition"
        aria-label={t("account.edit", lang)}
      >
        <Pencil size={16} />
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-fg/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative z-10 w-full max-w-lg bg-card rounded-t-2xl sm:rounded-2xl border border-border p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-lg">{t("account.edit", lang)}</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
                <X size={20} />
              </button>
            </div>

            <Field label={t("account.name", lang)}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
              />
            </Field>

            <Field label={t("account.bank", lang)}>
              <select value={bank} onChange={(e) => setBank(e.target.value)} className="field-input">
                {BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>

            <Field label={t("account.type", lang)}>
              <select value={type} onChange={(e) => setType(e.target.value)} className="field-input">
                {TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>{t(TYPE_LABEL_KEY[v], lang)}</option>
                ))}
              </select>
            </Field>

            {type === "credit_card" && (
              <Field label={t("account.cc_issuer", lang)}>
                <input
                  value={ccIssuer}
                  onChange={(e) => setCcIssuer(e.target.value)}
                  placeholder="nubank, itau, c6..."
                  className="field-input"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("account.real_balance", lang)}>
                <input
                  inputMode="decimal"
                  value={realStart}
                  onChange={(e) => setRealStart(e.target.value)}
                  className="field-input"
                />
              </Field>
              <Field label={t("account.shared_balance", lang)}>
                <input
                  inputMode="decimal"
                  value={sharedStart}
                  onChange={(e) => setSharedStart(e.target.value)}
                  className="field-input"
                />
              </Field>
            </div>

            {err && <p className="text-sm text-danger">{err}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={archive}
                disabled={busy}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium inline-flex items-center gap-2 transition ${
                  confirmDelete
                    ? "bg-danger text-bg border-danger"
                    : "text-danger border-danger/30 hover:bg-danger/10"
                }`}
              >
                <Trash2 size={14} />
                {confirmDelete ? t("account.confirm_delete", lang) : t("account.archive", lang)}
              </button>

              <button
                onClick={save}
                disabled={busy || !name}
                className="flex-1 py-2.5 rounded-xl bg-accent text-bg font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t("account.save", lang)}
              </button>
            </div>
          </div>

          <style jsx>{`
            :global(.field-input) {
              width: 100%;
              padding: 0.625rem 0.75rem;
              border-radius: 0.75rem;
              background: rgb(var(--bg));
              border: 1px solid rgb(var(--border));
              color: rgb(var(--fg));
              font-size: 0.875rem;
              outline: none;
            }
            :global(.field-input:focus) {
              border-color: rgb(var(--accent));
            }
          `}</style>
        </div>
      )}
    </>
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
