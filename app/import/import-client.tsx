"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  ArrowRight,
  RotateCcw
} from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";

type Account = { id: string; name: string; bank: string; type: string };

type PreviewTx = {
  externalId: string | null;
  date: string;
  amount: number;
  description: string;
  type?: string | null;
};

type Preview = {
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
  count: number;
  transactions: PreviewTx[];
  bankHint?: string | null;
  accountTypeHint?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
};

type Stage = "idle" | "uploading" | "parsing" | "preview" | "importing" | "done" | "error";

type DoneResult = { inserted: number; categorized: number; total: number; aiError?: string | null };

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
  const [stage, setStage] = useState<Stage>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [done, setDone] = useState<DoneResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const isWorking = stage === "uploading" || stage === "parsing" || stage === "importing";

  // Elapsed-time ticker for the long stages
  useEffect(() => {
    if (isWorking) {
      setElapsed(0);
      elapsedTimer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
    return () => {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    };
  }, [isWorking]);

  // Auto-redirect countdown after success
  useEffect(() => {
    if (stage === "done") {
      setRedirectIn(8);
      redirectTimer.current = setInterval(() => {
        setRedirectIn((r) => {
          if (r === null) return null;
          if (r <= 1) {
            if (redirectTimer.current) clearInterval(redirectTimer.current);
            router.push("/");
            return null;
          }
          return r - 1;
        });
      }, 1000);
    }
    return () => {
      if (redirectTimer.current) clearInterval(redirectTimer.current);
    };
  }, [stage, router]);

  async function upload() {
    if (!file || !accountId) return;
    setStage("uploading");
    setErr(null);
    setPreview(null);

    try {
      // Tiny delay so user sees "uploading" before parsing transition feels honest
      const fd = new FormData();
      fd.append("file", file);
      fd.append("accountId", accountId);

      const fileSize = file.size;
      const isLikelyPdf = file.name.toLowerCase().endsWith(".pdf");
      // For PDF we know parsing follows upload; switch stage when network has likely finished sending
      if (isLikelyPdf) {
        setTimeout(() => setStage((s) => (s === "uploading" ? "parsing" : s)), Math.min(5000, fileSize / 100));
      }

      const r = await fetch("/api/imports/upload", { method: "POST", body: fd });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro desconhecido");
        setStage("error");
        return;
      }
      setImportId(json.importId);
      if (json.preview) {
        setPreview(json.preview);
        setStage("preview");
      } else {
        // Non-parseable type — still uploaded
        setErr(json.message ?? "Arquivo salvo mas não foi possível processar.");
        setStage("error");
      }
    } catch (e) {
      setErr((e as Error).message);
      setStage("error");
    }
  }

  async function confirm() {
    if (!preview || !importId) return;
    setStage("importing");
    setErr(null);
    try {
      const r = await fetch("/api/imports/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId,
          accountId,
          transactions: preview.transactions
        })
      });
      const json: DoneResult & { error?: string } = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro ao importar");
        setStage("error");
        return;
      }
      setDone(json);
      setStage("done");
    } catch (e) {
      setErr((e as Error).message);
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setFile(null);
    setPreview(null);
    setImportId(null);
    setDone(null);
    setErr(null);
    setElapsed(0);
    setRedirectIn(null);
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-border p-6 text-center">
        <p className="text-sm text-muted mb-3">Crie uma conta primeiro.</p>
        <a
          href="/accounts/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-fg text-bg text-sm font-medium"
        >
          Criar conta <ArrowRight size={14} />
        </a>
      </div>
    );
  }

  // ============== UI per stage ==============

  if (stage === "done" && done) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-accent/10 border border-accent/30 p-7 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/20 text-accent mb-3 animate-[pop_0.3s_ease-out]">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-semibold mb-1">Importado!</h2>
          <p className="text-sm text-muted mb-5">
            {done.inserted} {done.inserted === 1 ? "movimento adicionado" : "movimentos adicionados"}
          </p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <Stat
              icon={<FileText size={14} />}
              label="Total importado"
              value={String(done.inserted)}
            />
            <Stat
              icon={<Sparkles size={14} />}
              label="Categorizados por IA"
              value={`${done.categorized}/${done.total}`}
            />
          </div>
          {done.aiError && (
            <p className="text-xs text-danger mb-3">
              ⚠ Categorização parcial: {done.aiError}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => router.push("/")}
              className="flex-1 px-4 py-3 rounded-xl bg-fg text-bg font-medium"
            >
              Ver dashboard {redirectIn !== null && `(${redirectIn}s)`}
            </button>
            <button
              onClick={reset}
              className="flex-1 px-4 py-3 rounded-xl bg-card border border-border font-medium inline-flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> Importar outro
            </button>
          </div>
        </div>
        <style jsx>{`
          @keyframes pop {
            0% { transform: scale(0.5); opacity: 0; }
            60% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (isWorking) {
    return <ProgressView stage={stage} elapsed={elapsed} fileName={file?.name ?? ""} />;
  }

  if (stage === "preview" && preview) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-accent/10 text-accent inline-flex items-center justify-center">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <h2 className="font-medium">Arquivo analisado</h2>
              <p className="text-xs text-muted">
                {preview.count} {preview.count === 1 ? "movimento" : "movimentos"} encontrado{preview.count === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {preview.bankHint && (
              <Stat icon={<FileText size={14} />} label="Banco" value={preview.bankHint} />
            )}
            {preview.closingBalance !== null && (
              <Stat
                icon={<FileText size={14} />}
                label="Saldo no extrato"
                value={formatBRL(preview.closingBalance)}
              />
            )}
            {preview.periodStart && preview.periodEnd && (
              <Stat
                icon={<FileText size={14} />}
                label="Período"
                value={`${formatDate(preview.periodStart)} → ${formatDate(preview.periodEnd)}`}
              />
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-card border border-border p-4">
          <h3 className="text-xs uppercase tracking-wider text-muted mb-3 px-1">
            Pré-visualização ({Math.min(preview.transactions.length, 10)} de {preview.count})
          </h3>
          <div className="max-h-72 overflow-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {preview.transactions.slice(0, 50).map((t, i) => (
                  <tr key={i} className="border-t border-border first:border-t-0">
                    <td className="p-2 text-xs text-muted tabular-nums w-20">{formatDate(t.date)}</td>
                    <td className="p-2 truncate max-w-[18ch]">{t.description}</td>
                    <td
                      className={`p-2 text-right tabular-nums font-medium ${
                        t.amount > 0 ? "text-accent" : ""
                      }`}
                    >
                      {t.amount > 0 ? "+" : ""}
                      {formatBRL(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 px-4 py-3 rounded-xl bg-card border border-border text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            className="flex-[2] px-4 py-3 rounded-xl bg-accent text-bg font-medium inline-flex items-center justify-center gap-2"
          >
            <Sparkles size={16} /> Importar e categorizar com IA
          </button>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-danger/10 border border-danger/30 p-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-danger/20 text-danger mb-3">
            <XCircle size={28} />
          </div>
          <h2 className="text-lg font-semibold mb-1">Algo deu errado</h2>
          <p className="text-sm text-muted mb-4">{err}</p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border text-sm font-medium"
          >
            <RotateCcw size={14} /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Idle
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        upload();
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">Conta</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full p-3 rounded-xl bg-card border border-border text-sm outline-none focus:border-accent"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.bank})
            </option>
          ))}
        </select>
      </label>

      <label
        className={`block rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
          file ? "border-accent/50 bg-accent/5" : "border-border hover:border-accent/40 hover:bg-card"
        }`}
      >
        <input
          type="file"
          accept=".ofx,.qfx,.csv,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {file ? (
          <div className="flex items-center gap-3 justify-center">
            <FileText size={28} className="text-accent" />
            <div className="text-left">
              <p className="font-medium truncate max-w-[20ch]">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload size={28} className="mx-auto text-muted" />
            <p className="text-sm">
              Toque para escolher um arquivo
              <br />
              <span className="text-xs text-muted">.ofx · .pdf · .csv · .qfx</span>
            </p>
          </div>
        )}
      </label>

      <button
        type="submit"
        disabled={!file || !accountId}
        className="w-full p-3.5 rounded-xl bg-fg text-bg font-medium disabled:opacity-40 inline-flex items-center justify-center gap-2"
      >
        <Sparkles size={16} /> Enviar e analisar
      </button>

      <p className="text-center text-xs text-muted">
        Aceita extratos do Itaú, Bradesco, Nubank, Inter, BTG e outros bancos brasileiros.
        <br />
        PDF é analisado por IA (Gemini 2.5) e pode levar até 60 segundos.
      </p>
    </form>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Stat({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-bg border border-border">
      <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
        {icon}
        {label}
      </p>
      <p className="font-semibold tabular-nums mt-1">{value}</p>
    </div>
  );
}

function ProgressView({
  stage,
  elapsed,
  fileName
}: {
  stage: Stage;
  elapsed: number;
  fileName: string;
}) {
  const steps = [
    {
      key: "uploading",
      label: "Enviando arquivo",
      hint: "Subindo para o servidor..."
    },
    {
      key: "parsing",
      label: "Analisando com IA",
      hint: "Gemini está lendo o seu extrato e extraindo os movimentos. Isso pode levar 30 a 50 segundos."
    },
    {
      key: "importing",
      label: "Categorizando e salvando",
      hint: "Aplicando categorias com IA e gravando no banco de dados."
    }
  ] as const;

  const idx = steps.findIndex((s) => s.key === stage);
  const current = steps[idx];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card border border-border p-6">
        <header className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-full bg-accent/10 text-accent inline-flex items-center justify-center">
            <Loader2 size={22} className="animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted truncate">{fileName}</p>
            <h2 className="font-medium leading-tight">{current?.label ?? "Processando..."}</h2>
          </div>
          <span className="text-sm text-muted tabular-nums">{elapsed}s</span>
        </header>
        <p className="text-xs text-muted leading-relaxed">{current?.hint}</p>

        <ol className="mt-5 space-y-2">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className={`flex items-center gap-2.5 text-xs ${
                i < idx ? "text-accent" : i === idx ? "text-fg" : "text-muted"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] ${
                  i < idx
                    ? "bg-accent text-bg"
                    : i === idx
                      ? "bg-accent/20 text-accent"
                      : "bg-card border border-border"
                }`}
              >
                {i < idx ? "✓" : i + 1}
              </span>
              {s.label}
              {i === idx && <Loader2 size={11} className="animate-spin opacity-50 ml-1" />}
            </li>
          ))}
        </ol>
      </div>

      <p className="text-center text-xs text-muted">
        Por favor não feche essa tela. O processamento continua mesmo se você voltar, mas
        você pode perder o aviso de conclusão.
      </p>
    </div>
  );
}
