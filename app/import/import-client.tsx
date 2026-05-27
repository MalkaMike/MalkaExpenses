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
  RotateCcw,
  AlertTriangle,
  CreditCard
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

type SingleStage = "idle" | "uploading" | "parsing" | "preview" | "importing" | "done" | "error";

type DoneResult = {
  inserted: number;
  duplicates: number;
  ruleMatched?: number;
  categorized: number;
  researched?: number;
  total: number;
  aiError?: string | null;
};

// ─── Bulk types ───────────────────────────────────────────────────────────────
type FileStatus = "waiting" | "uploading" | "parsing" | "importing" | "done" | "error";

type BulkFileItem = {
  file: File;
  status: FileStatus;
  inserted?: number;
  duplicates?: number;
  categorized?: number;
  total?: number;
  error?: string;
};

type BulkStage = "bulk_idle" | "bulk_processing" | "bulk_done";

export function ImportClient({
  accounts,
  defaultAccountId
}: {
  accounts: Account[];
  defaultAccountId?: string;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");

  // ── Single-file state ──────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [singleStage, setSingleStage] = useState<SingleStage>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [done, setDone] = useState<DoneResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Bulk-file state ────────────────────────────────────────────────────────
  const [bulkFiles, setBulkFiles] = useState<BulkFileItem[]>([]);
  const [bulkStage, setBulkStage] = useState<BulkStage>("bulk_idle");
  const [bulkElapsed, setBulkElapsed] = useState(0);
  const bulkElapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Mode detection ─────────────────────────────────────────────────────────
  const isBulk = bulkFiles.length > 1;

  const isSingleWorking =
    singleStage === "uploading" || singleStage === "parsing" || singleStage === "importing";

  // ── Timers ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSingleWorking) {
      setElapsed(0);
      elapsedTimer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    }
    return () => {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    };
  }, [isSingleWorking]);

  useEffect(() => {
    if (bulkStage === "bulk_processing") {
      setBulkElapsed(0);
      bulkElapsedTimer.current = setInterval(() => setBulkElapsed((s) => s + 1), 1000);
    } else {
      if (bulkElapsedTimer.current) clearInterval(bulkElapsedTimer.current);
    }
    return () => {
      if (bulkElapsedTimer.current) clearInterval(bulkElapsedTimer.current);
    };
  }, [bulkStage]);

  useEffect(() => {
    if (singleStage === "done") {
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
  }, [singleStage, router]);

  // ── File selection handler ─────────────────────────────────────────────────
  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;
    if (selected.length === 1) {
      setFile(selected[0]);
      setBulkFiles([]);
    } else {
      const capped = selected.slice(0, 12);
      setFile(null);
      setBulkFiles(capped.map((f) => ({ file: f, status: "waiting" })));
    }
    // reset stages
    setSingleStage("idle");
    setBulkStage("bulk_idle");
    setErr(null);
    setPreview(null);
    setImportId(null);
    setDone(null);
  }

  // ── Single-file upload ─────────────────────────────────────────────────────
  async function upload() {
    if (!file || !accountId) return;
    setSingleStage("uploading");
    setErr(null);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("accountId", accountId);
      const isLikelyPdf = file.name.toLowerCase().endsWith(".pdf");
      if (isLikelyPdf) {
        setTimeout(
          () => setSingleStage((s) => (s === "uploading" ? "parsing" : s)),
          Math.min(5000, file.size / 100)
        );
      }
      const r = await fetch("/api/imports/upload", { method: "POST", body: fd });
      const json = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro desconhecido");
        setSingleStage("error");
        return;
      }
      setImportId(json.importId);
      if (json.preview) {
        setPreview(json.preview);
        setSingleStage("preview");
      } else {
        setErr(json.message ?? "Arquivo salvo mas não foi possível processar.");
        setSingleStage("error");
      }
    } catch (e) {
      setErr((e as Error).message);
      setSingleStage("error");
    }
  }

  // ── Single-file confirm ────────────────────────────────────────────────────
  async function confirm() {
    if (!preview || !importId) return;
    setSingleStage("importing");
    setErr(null);
    try {
      const r = await fetch("/api/imports/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId, accountId, transactions: preview.transactions })
      });
      const json: DoneResult & { error?: string } = await r.json();
      if (!r.ok) {
        setErr(json.error ?? "erro ao importar");
        setSingleStage("error");
        return;
      }
      setDone(json);
      setSingleStage("done");
    } catch (e) {
      setErr((e as Error).message);
      setSingleStage("error");
    }
  }

  // ── Bulk processing ────────────────────────────────────────────────────────
  async function startBulk() {
    if (!accountId || bulkFiles.length === 0) return;
    setBulkStage("bulk_processing");

    let updatedFiles = bulkFiles.map((f) => ({ ...f }));

    for (let i = 0; i < updatedFiles.length; i++) {
      // Mark current as uploading
      updatedFiles = updatedFiles.map((f, idx) =>
        idx === i ? { ...f, status: "uploading" as FileStatus } : f
      );
      setBulkFiles([...updatedFiles]);

      try {
        // Step 1: upload + parse
        const fd = new FormData();
        fd.append("file", updatedFiles[i].file);
        fd.append("accountId", accountId);

        // Switch to "parsing" status ~3s in (PDF analysis takes 30-60s via Gemini)
        const parseTimer = setTimeout(() => {
          setBulkFiles((prev) =>
            prev.map((f, idx) =>
              idx === i && f.status === "uploading"
                ? { ...f, status: "parsing" as FileStatus }
                : f
            )
          );
        }, 3000);

        const uploadRes = await fetch("/api/imports/upload", { method: "POST", body: fd });
        clearTimeout(parseTimer);

        if (!uploadRes.ok) {
          const j = await uploadRes.json().catch(() => ({}));
          updatedFiles = updatedFiles.map((f, idx) =>
            idx === i ? { ...f, status: "error" as FileStatus, error: j.error ?? "upload falhou" } : f
          );
          setBulkFiles([...updatedFiles]);
          continue;
        }

        const uploadJson = await uploadRes.json();
        if (!uploadJson.preview || !uploadJson.importId) {
          updatedFiles = updatedFiles.map((f, idx) =>
            idx === i
              ? { ...f, status: "error" as FileStatus, error: "não foi possível processar o arquivo" }
              : f
          );
          setBulkFiles([...updatedFiles]);
          continue;
        }

        // Step 2: auto-confirm (no manual preview in bulk mode)
        updatedFiles = updatedFiles.map((f, idx) =>
          idx === i ? { ...f, status: "importing" as FileStatus } : f
        );
        setBulkFiles([...updatedFiles]);

        const confirmRes = await fetch("/api/imports/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importId: uploadJson.importId,
            accountId,
            transactions: uploadJson.preview.transactions
          })
        });

        const confirmJson = await confirmRes.json();
        if (!confirmRes.ok) {
          updatedFiles = updatedFiles.map((f, idx) =>
            idx === i
              ? { ...f, status: "error" as FileStatus, error: confirmJson.error ?? "erro ao importar" }
              : f
          );
        } else {
          updatedFiles = updatedFiles.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: "done" as FileStatus,
                  inserted: confirmJson.inserted,
                  duplicates: confirmJson.duplicates,
                  categorized: confirmJson.categorized,
                  researched: confirmJson.researched ?? 0,
                  total: confirmJson.total
                }
              : f
          );
        }
        setBulkFiles([...updatedFiles]);
      } catch (e) {
        updatedFiles = updatedFiles.map((f, idx) =>
          idx === i
            ? { ...f, status: "error" as FileStatus, error: (e as Error).message }
            : f
        );
        setBulkFiles([...updatedFiles]);
      }
    }

    setBulkStage("bulk_done");
  }

  function reset() {
    setSingleStage("idle");
    setBulkStage("bulk_idle");
    setFile(null);
    setBulkFiles([]);
    setPreview(null);
    setImportId(null);
    setDone(null);
    setErr(null);
    setElapsed(0);
    setRedirectIn(null);
  }

  // ── Early returns ──────────────────────────────────────────────────────────
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

  // ── Bulk views ─────────────────────────────────────────────────────────────
  if (isBulk && bulkStage === "bulk_processing") {
    const done = bulkFiles.filter((f) => f.status === "done").length;
    const errors = bulkFiles.filter((f) => f.status === "error").length;
    const current = bulkFiles.find(
      (f) => f.status === "uploading" || f.status === "parsing" || f.status === "importing"
    );
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-full bg-accent/10 text-accent inline-flex items-center justify-center">
              <Loader2 size={20} className="animate-spin" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Processando {bulkFiles.length} arquivos...</p>
              <p className="text-xs text-muted">
                {done} de {bulkFiles.length} concluídos · {bulkElapsed}s
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {bulkFiles.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <BulkStatusIcon status={f.status} />
                <span className="flex-1 truncate text-xs">{f.file.name}</span>
                {f.status === "done" && (
                  <span className="text-[10px] text-accent tabular-nums">
                    +{f.inserted} novos
                    {f.duplicates ? ` · ${f.duplicates} já existiam` : ""}
                  </span>
                )}
                {f.status === "error" && (
                  <span className="text-[10px] text-danger truncate max-w-[16ch]">{f.error}</span>
                )}
                {f.status === "uploading" && (
                  <span className="text-[10px] text-muted">enviando...</span>
                )}
                {f.status === "parsing" && (
                  <span className="text-[10px] text-accent font-medium">✦ Gemini a ler PDF...</span>
                )}
                {f.status === "importing" && (
                  <span className="text-[10px] text-accent font-medium">✦ IA a categorizar...</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        {current && (
          <p className="text-center text-xs text-muted">
            Por favor não feche essa tela. O processamento continua em segundo plano.
          </p>
        )}
      </div>
    );
  }

  if (isBulk && bulkStage === "bulk_done") {
    const totalInserted = bulkFiles.reduce((s, f) => s + (f.inserted ?? 0), 0);
    const totalDuplicates = bulkFiles.reduce((s, f) => s + (f.duplicates ?? 0), 0);
    const totalCategorized = bulkFiles.reduce((s, f) => s + (f.categorized ?? 0), 0);
    const errorFiles = bulkFiles.filter((f) => f.status === "error");
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-accent/10 border border-accent/30 p-6">
          <div className="text-center mb-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent/20 text-accent mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-xl font-semibold">
              {bulkFiles.length} {bulkFiles.length === 1 ? "arquivo" : "arquivos"} processados
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Stat icon={<FileText size={13} />} label="Novos" value={String(totalInserted)} />
            <Stat icon={<Sparkles size={13} />} label="Categorizados" value={String(totalCategorized)} />
            <Stat
              icon={<AlertTriangle size={13} />}
              label="Já existiam"
              value={String(totalDuplicates)}
            />
          </div>

          {errorFiles.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-danger/10 border border-danger/30">
              <p className="text-xs text-danger font-medium mb-1">
                {errorFiles.length} {errorFiles.length === 1 ? "arquivo com erro:" : "arquivos com erro:"}
              </p>
              {errorFiles.map((f, i) => (
                <p key={i} className="text-xs text-danger truncate">
                  {f.file.name}: {f.error}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => router.push("/")}
              className="flex-1 px-4 py-3 rounded-xl bg-fg text-bg font-medium"
            >
              Ver dashboard
            </button>
            <button
              onClick={reset}
              className="flex-1 px-4 py-3 rounded-xl bg-card border border-border font-medium inline-flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> Importar mais
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Single-file views ──────────────────────────────────────────────────────
  if (singleStage === "done" && done) {
    const allDuplicates = done.duplicates > 0 && done.inserted === 0;
    const someDuplicates = done.duplicates > 0 && done.inserted > 0;
    return (
      <div className="space-y-4">
        <div
          className={`rounded-2xl border p-7 text-center ${
            allDuplicates
              ? "bg-warning/10 border-warning/40"
              : "bg-accent/10 border-accent/30"
          }`}
        >
          <div
            className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 animate-[pop_0.3s_ease-out] ${
              allDuplicates ? "bg-warning/20 text-warning" : "bg-accent/20 text-accent"
            }`}
          >
            <CheckCircle2 size={32} />
          </div>
          {allDuplicates ? (
            <>
              <h2 className="text-xl font-semibold mb-1">Arquivo já importado</h2>
              <p className="text-sm text-muted mb-5">
                Todos os {done.total} {done.total === 1 ? "movimento" : "movimentos"}{" "}
                deste arquivo já existem. Nenhum dado novo foi adicionado.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold mb-1">Importado!</h2>
              <p className="text-sm text-muted mb-5">
                {done.inserted}{" "}
                {done.inserted === 1 ? "movimento adicionado" : "movimentos adicionados"}
              </p>
            </>
          )}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat icon={<FileText size={14} />} label="Novos" value={String(done.inserted)} />
            <Stat
              icon={<Sparkles size={14} />}
              label="Categorizados"
              value={done.inserted > 0 ? `${done.categorized}/${done.inserted}` : "—"}
            />
            {(done.ruleMatched ?? 0) > 0 && (
              <Stat
                icon={<CheckCircle2 size={14} />}
                label="Via regra"
                value={String(done.ruleMatched)}
              />
            )}
            {(done.researched ?? 0) > 0 && (
              <Stat
                icon={<Sparkles size={14} />}
                label="Pesquisados"
                value={String(done.researched)}
              />
            )}
          </div>
          {someDuplicates && (
            <div className="mb-4 p-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-xs text-left">
              ⚠ {done.duplicates}{" "}
              {done.duplicates === 1 ? "movimento já existia" : "movimentos já existiam"} e{" "}
              {done.duplicates === 1 ? "foi ignorado" : "foram ignorados"}.
            </div>
          )}
          {done.aiError && (
            <p className="text-xs text-danger mb-3">⚠ Categorização parcial: {done.aiError}</p>
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

  if (isSingleWorking) {
    return <ProgressView stage={singleStage} elapsed={elapsed} fileName={file?.name ?? ""} />;
  }

  if (singleStage === "preview" && preview) {
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
                {preview.count}{" "}
                {preview.count === 1 ? "movimento" : "movimentos"} encontrado
                {preview.count === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          {preview.count === 0 && (
            <div className="rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm px-3 py-2">
              ⚠ Nenhuma transação foi extraída deste arquivo. Verifique se o PDF contém um extrato legível ou tente outro formato (OFX/QFX).
            </div>
          )}
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
                    <td className="p-2 text-xs text-muted tabular-nums w-20">
                      {formatDate(t.date)}
                    </td>
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
            disabled={preview.count === 0}
            className="flex-[2] px-4 py-3 rounded-xl bg-accent text-bg font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title={preview.count === 0 ? "Nenhuma transação encontrada no arquivo" : undefined}
          >
            <Sparkles size={16} />
            {preview.count === 0
              ? "Nenhuma transação encontrada"
              : "Importar e categorizar com IA"}
          </button>
        </div>
      </div>
    );
  }

  if (singleStage === "error") {
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

  // ── Idle (single or multi-select) ─────────────────────────────────────────
  const hasSelectedFiles = file !== null || bulkFiles.length > 0;

  return (
    <div className="space-y-4">
      {/* Account selector */}
      <label className="block">
        <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">Conta</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full p-3 rounded-xl bg-card border border-border text-sm outline-none focus:border-accent"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.bank}){a.type === "credit_card" ? " · Cartão" : ""}
            </option>
          ))}
        </select>
        {accounts.some((a) => a.type === "credit_card") && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted">
            <CreditCard size={10} />
            Cartões de crédito aparecem na lista — as faturas serão reconciliadas automaticamente.
          </p>
        )}
      </label>

      {/* Drop zone */}
      <label
        className={`block rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
          hasSelectedFiles
            ? "border-accent/50 bg-accent/5"
            : "border-border hover:border-accent/40 hover:bg-card"
        }`}
      >
        <input
          type="file"
          accept=".ofx,.qfx,.csv,.pdf"
          multiple
          onChange={onFilesSelected}
          className="sr-only"
        />

        {/* Single file */}
        {file && (
          <div className="flex items-center gap-3 justify-center">
            <FileText size={28} className="text-accent flex-shrink-0" />
            <div className="text-left min-w-0">
              <p className="font-medium truncate max-w-[22ch]">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
        )}

        {/* Multiple files */}
        {bulkFiles.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 justify-center mb-2">
              <FileText size={22} className="text-accent" />
              <span className="font-medium">{bulkFiles.length} arquivos selecionados</span>
            </div>
            <div className="max-h-32 overflow-auto text-left space-y-1">
              {bulkFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-4 h-4 rounded-full bg-accent/10 text-accent inline-flex items-center justify-center text-[10px] flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="truncate text-muted">{f.file.name}</span>
                  <span className="ml-auto text-muted flex-shrink-0">
                    {(f.file.size / 1024).toFixed(0)}KB
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted mt-1">Clique para mudar a seleção</p>
          </div>
        )}

        {/* Empty */}
        {!hasSelectedFiles && (
          <div className="space-y-2">
            <Upload size={28} className="mx-auto text-muted" />
            <p className="text-sm">
              Toque para escolher arquivos
              <br />
              <span className="text-xs text-muted">.ofx · .pdf · .csv · .qfx</span>
            </p>
            <p className="text-xs text-muted">Selecione até 12 arquivos de uma vez</p>
          </div>
        )}
      </label>

      {/* Action button */}
      {isBulk ? (
        <button
          onClick={startBulk}
          disabled={!accountId}
          className="w-full p-3.5 rounded-xl bg-fg text-bg font-medium disabled:opacity-40 inline-flex items-center justify-center gap-2"
        >
          <Sparkles size={16} /> Importar e categorizar {bulkFiles.length} arquivos com IA
        </button>
      ) : (
        <button
          onClick={upload}
          disabled={!file || !accountId}
          className="w-full p-3.5 rounded-xl bg-fg text-bg font-medium disabled:opacity-40 inline-flex items-center justify-center gap-2"
        >
          <Sparkles size={16} /> Enviar e analisar
        </button>
      )}

      <p className="text-center text-xs text-muted">
        Itaú, Bradesco, Nubank, Inter, BTG e outros bancos brasileiros.
        <br />
        PDF é analisado por IA (Gemini 2.5) — até 60s por arquivo.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-bg border border-border">
      <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
        {icon} {label}
      </p>
      <p className="font-semibold tabular-nums mt-1">{value}</p>
    </div>
  );
}

function BulkStatusIcon({ status }: { status: FileStatus }) {
  if (status === "done") return <CheckCircle2 size={16} className="text-accent flex-shrink-0" />;
  if (status === "error") return <XCircle size={16} className="text-danger flex-shrink-0" />;
  if (status === "uploading" || status === "parsing" || status === "importing") {
    return <Loader2 size={16} className="animate-spin text-accent flex-shrink-0" />;
  }
  return (
    <span className="w-4 h-4 rounded-full border border-border bg-bg flex-shrink-0 inline-block" />
  );
}

function ProgressView({
  stage,
  elapsed,
  fileName
}: {
  stage: SingleStage;
  elapsed: number;
  fileName: string;
}) {
  const steps = [
    { key: "uploading", label: "Enviando arquivo", hint: "Subindo para o servidor..." },
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
        Por favor não feche essa tela. O processamento continua mesmo se você voltar.
      </p>
    </div>
  );
}
