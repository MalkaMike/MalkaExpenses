"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatDate } from "@/lib/format";

type Account = { id: string; name: string; bank: string; type: string };

type Preview = {
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
  count: number;
  transactions: Array<{
    externalId: string | null;
    date: string;
    amount: number;
    description: string;
    type: string | null;
  }>;
};

export function ImportClient({
  accounts,
  defaultAccountId
}: {
  accounts: Account[];
  defaultAccountId?: string;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !accountId) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("accountId", accountId);
      const r = await fetch("/api/import/upload", { method: "POST", body: fd });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro");
        return;
      }
      setImportId(json.importId);
      setPreview(json.preview);
      if (!json.preview) setMsg(json.message ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || !importId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId,
          accountId,
          transactions: preview.transactions
        })
      });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro");
        return;
      }
      setMsg(`${json.inserted} de ${json.total} movimentos importados`);
      setPreview(null);
      setImportId(null);
      setFile(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Crie uma conta primeiro em <a href="/accounts/new" className="underline">Nova conta</a>.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={upload} className="space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-muted mb-1">Conta</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full p-3 rounded-lg bg-card border border-border"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.bank})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-muted mb-1">
            Arquivo (.ofx, .qfx, .csv, .pdf)
          </span>
          <input
            type="file"
            accept=".ofx,.qfx,.csv,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!file || !accountId || busy}
          className="w-full p-3 rounded-xl bg-fg text-bg disabled:opacity-40 font-medium"
        >
          {busy ? "Enviando..." : "Enviar"}
        </button>
        {err && <p className="text-sm text-danger">{err}</p>}
        {msg && <p className="text-sm text-accent">{msg}</p>}
      </form>

      {preview && (
        <section className="space-y-3">
          <h2 className="font-medium">Pré-visualização: {preview.count} movimentos</h2>
          {preview.closingBalance !== null && (
            <p className="text-sm text-muted">
              Saldo no arquivo: <span className="text-fg tabular-nums">{formatBRL(preview.closingBalance)}</span>
            </p>
          )}
          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="text-left p-2">data</th>
                  <th className="text-left p-2">descrição</th>
                  <th className="text-right p-2">valor</th>
                </tr>
              </thead>
              <tbody>
                {preview.transactions.map((t, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 tabular-nums">{formatDate(t.date)}</td>
                    <td className="p-2 truncate max-w-[18ch]">{t.description}</td>
                    <td className="p-2 text-right tabular-nums">{formatBRL(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={confirm}
            disabled={busy}
            className="w-full p-3 rounded-xl bg-accent text-bg disabled:opacity-40 font-medium"
          >
            {busy ? "Importando..." : `Importar ${preview.count} movimentos`}
          </button>
        </section>
      )}
    </div>
  );
}
