"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { t, type StringKey } from "@/lib/i18n/translations";

const BANKS = ["itau", "bradesco", "santander", "nubank", "inter", "btg", "c6", "outro"];
const TYPE_VALUES = ["checking", "savings", "credit_card"] as const;
const TYPE_LABEL_KEY: Record<string, StringKey> = {
  checking: "acct_type.checking_full",
  savings: "acct_type.savings_full",
  credit_card: "acct_type.credit_card_full"
};

export function NewAccountForm() {
  const router = useRouter();
  const { lang } = useLang();
  const [name, setName] = useState("");
  const [bank, setBank] = useState("itau");
  const [type, setType] = useState("checking");
  const [realStart, setRealStart] = useState("0");
  const [sharedStart, setSharedStart] = useState("");
  const [ccIssuer, setCcIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const realStartNum = Number(realStart.replace(",", ".")) || 0;
      const sharedStartNum =
        sharedStart === "" ? realStartNum : Number(sharedStart.replace(",", ".")) || 0;
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          bank,
          type,
          real_starting_balance: realStartNum,
          shared_starting_balance: sharedStartNum,
          cc_issuer: type === "credit_card" ? ccIssuer || null : null
        })
      });
      if (!r.ok) {
        setErr((await r.json()).error ?? "erro");
        return;
      }
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("account.name", lang)}>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("account.name_ph", lang)}
          className="input"
        />
      </Field>
      <Field label={t("account.bank", lang)}>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className="input">
          {BANKS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </Field>
      <Field label={t("account.type", lang)}>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input">
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
            placeholder="nubank, itau, c6, ..."
            className="input"
          />
        </Field>
      )}
      <Field label={t("account.real_balance", lang)}>
        <input
          inputMode="decimal"
          value={realStart}
          onChange={(e) => setRealStart(e.target.value)}
          className="input"
        />
      </Field>
      <Field label={t("account.shared_balance_new", lang)}>
        <input
          inputMode="decimal"
          value={sharedStart}
          onChange={(e) => setSharedStart(e.target.value)}
          placeholder={t("account.same_as_real", lang)}
          className="input"
        />
      </Field>
      {err && <p className="text-sm text-danger">{err}</p>}
      <button
        type="submit"
        disabled={busy || !name}
        className="w-full p-3 rounded-xl bg-fg text-bg disabled:opacity-40 font-medium"
      >
        {t("account.create", lang)}
      </button>
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          background: rgb(var(--card));
          border: 1px solid rgb(var(--border));
          color: rgb(var(--fg));
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
