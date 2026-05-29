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
import { useLang } from "@/lib/i18n/context";
import { t, type Lang } from "@/lib/i18n/translations";

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
  reconciled?: number;
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
  const { lang } = useLang();
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setErr(json.error ?? t("import.err_unknown", lang));
        setSingleStage("error");
        return;
      }
      setImportId(json.importId);
      if (json.preview) {
        setPreview(json.preview);
        setSingleStage("preview");
      } else {
        setErr(json.message ?? t("import.err_unprocessable", lang));
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
        setErr(json.error ?? t("import.err_import", lang));
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
            idx === i ? { ...f, status: "error" as FileStatus, error: j.error ?? t("import.err_upload", lang) } : f
          );
          setBulkFiles([...updatedFiles]);
          continue;
        }

        const uploadJson = await uploadRes.json();
        if (!uploadJson.preview || !uploadJson.importId) {
          updatedFiles = updatedFiles.map((f, idx) =>
            idx === i
              ? { ...f, status: "error" as FileStatus, error: t("import.err_unprocessable_file", lang) }
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
              ? { ...f, status: "error" as FileStatus, error: confirmJson.error ?? t("import.err_import", lang) }
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
        <p className="text-sm text-muted mb-3">{t("import.need_account", lang)}</p>
        <a
          href="/accounts/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-fg text-bg text-sm font-medium"
        >
          {t("import.create_account", lang)} <ArrowRight size={14} />
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
              <p className="font-medium">{t("import.processing_files", lang)} {bulkFiles.length} {t("import.files_word", lang)}...</p>
              <p className="text-xs text-muted">
                {done} {t("import.of", lang)} {bulkFiles.length} {t("import.bulk_done_word", lang)} · {bulkElapsed}s
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
                    +{f.inserted} {t("import.new_count", lang)}
                    {f.duplicates ? ` · ${f.duplicates} ${t("import.already_existed", lang)}` : ""}
                  </span>
                )}
                {f.status === "error" && (
                  <span className="text-[10px] text-danger truncate max-w-[16ch]">{f.error}</span>
                )}
                {f.status === "uploading" && (
                  <span className="text-[10px] text-muted">{t("import.sending", lang)}</span>
                )}
                {f.status === "parsing" && (
                  <span className="text-[10px] text-accent font-medium">{t("import.parsing_pdf", lang)}</span>
                )}
                {f.status === "importing" && (
                  <span className="text-[10px] text-accent font-medium">{t("import.ai_cat", lang)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        {current && (
          <p className="text-center text-xs text-muted">
            {t("import.dont_close", lang)}
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
              {bulkFiles.length} {bulkFiles.length === 1 ? t("import.file_one", lang) : t("import.file_many", lang)} {t("import.processed", lang)}
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Stat icon={<FileText size={13} />} label={t("import.stat_new", lang)} value={String(totalInserted)} />
            <Stat icon={<Sparkles size={13} />} label={t("import.stat_categorized", lang)} value={String(totalCategorized)} />
            <Stat
              icon={<AlertTriangle size={13} />}
              label={t("import.stat_existed", lang)}
              value={String(totalDuplicates)}
            />
          </div>

          {errorFiles.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-danger/10 border border-danger/30">
              <p className="text-xs text-danger font-medium mb-1">
                {errorFiles.length} {errorFiles.length === 1 ? t("import.file_with_error_one", lang) : t("import.file_with_error_many", lang)}
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
              {t("import.see_dashboard", lang)}
            </button>
            <button
              onClick={reset}
              className="flex-1 px-4 py-3 rounded-xl bg-card border border-border font-medium inline-flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> {t("import.import_more", lang)}
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
              <h2 className="text-xl font-semibold mb-1">{t("import.done_dupe_title", lang)}</h2>
              <p className="text-sm text-muted mb-5">
                {done.total === 1
                  ? t("import.done_dupe_one", lang)
                  : `${t("import.done_dupe_many_a", lang)} ${done.total} ${t("import.done_dupe_many_b", lang)}`}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold mb-1">{t("import.done_title", lang)}</h2>
              <p className="text-sm text-muted mb-5">
                {done.inserted === 1 ? t("import.done_added_one", lang) : `${done.inserted} ${t("import.done_added_many", lang)}`}
                {done.categorized < done.inserted && (
                  <span className="text-warning"> · {t("import.some_need_review", lang)}</span>
                )}
              </p>
            </>
          )}
          <div className="grid grid-cols-2 gap-3 mb-4 text-left">
            <Stat icon={<FileText size={14} />} label={t("import.stat_new", lang)} value={String(done.inserted)} />
            <Stat
              icon={<Sparkles size={14} />}
              label={t("import.stat_categorized", lang)}
              value={done.inserted > 0 ? `${done.categorized}/${done.inserted}` : "—"}
            />
            {(done.ruleMatched ?? 0) > 0 && (
              <Stat
                icon={<CheckCircle2 size={14} />}
                label={t("import.stat_via_rule", lang)}
                value={String(done.ruleMatched)}
              />
            )}
            {(done.researched ?? 0) > 0 && (
              <Stat
                icon={<Sparkles size={14} />}
                label={t("import.stat_researched", lang)}
                value={String(done.researched)}
              />
            )}
            {(done.reconciled ?? 0) > 0 && (
              <Stat
                icon={<CheckCircle2 size={14} />}
                label={t("import.stat_reconciled", lang)}
                value={String(done.reconciled)}
              />
            )}
          </div>
          {someDuplicates && (
            <div className="mb-4 p-4 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm text-left">
              <strong>⚠ {done.duplicates} {done.duplicates === 1 ? t("import.dupe_one", lang) : t("import.dupe_many", lang)} {done.duplicates === 1 ? t("import.dupe_ignored_one", lang) : t("import.dupe_ignored_many", lang)}</strong>
              {" "}{done.duplicates === 1 ? t("import.dupe_existed_one", lang) : t("import.dupe_existed_many", lang)}
            </div>
          )}
          {done.aiError && (
            <div className="mb-4 p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm text-left">
              ⚠ {t("import.cat_incomplete", lang)} {done.aiError}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            {done.categorized < done.inserted && done.inserted > 0 && (
              <button
                onClick={() => router.push("/admin/review")}
                className="flex-1 px-4 py-3 rounded-xl bg-warning/10 border border-warning/30 text-warning font-medium inline-flex items-center justify-center gap-2"
              >
                {t("import.review_cats", lang)}
              </button>
            )}
            <button
              onClick={() => router.push("/")}
              className="flex-1 px-4 py-3 rounded-xl bg-fg text-bg font-medium"
            >
              {t("import.dashboard", lang)} {redirectIn !== null && `(${redirectIn}s)`}
            </button>
            <button
              onClick={reset}
              className="flex-1 px-4 py-3 rounded-xl bg-card border border-border font-medium inline-flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> {t("import.import_another", lang)}
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
    return <ProgressView stage={singleStage} elapsed={elapsed} fileName={file?.name ?? ""} lang={lang} />;
  }

  if (singleStage === "preview" && preview) {
    const selectedAccount = accounts.find((a) => a.id === accountId);
    return (
      <div className="grid lg:grid-cols-[2fr_3fr] gap-5 items-start">
        {/* LEFT — upload summary */}
        <div className="space-y-4">
          {/* Step 1 — account used */}
          <div className="rounded-2xl bg-card border border-border p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted mb-2 font-medium">
              1 — {t("import.account", lang)}
            </p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-accent/50 bg-accent/5">
              <CheckCircle2 size={16} className="text-accent flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {selectedAccount?.name ?? accountId}
              </span>
              {selectedAccount && (
                <span className="ml-auto text-[10px] text-muted flex-shrink-0">
                  {selectedAccount.bank}
                </span>
              )}
            </div>
          </div>

          {/* Step 2 — file uploaded */}
          <div className="rounded-2xl bg-card border border-border p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted mb-2 font-medium">
              2 — {t("import.file_analyzed", lang)}
            </p>
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-accent/50 bg-accent/5">
              <FileText size={18} className="text-accent flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{file?.name ?? "—"}</p>
                <p className="text-[11px] text-muted">
                  {preview.count}{" "}
                  {preview.count === 1 ? t("import.tx_found_one", lang) : t("import.tx_found_many", lang)}
                  {preview.bankHint ? ` · ${preview.bankHint}` : ""}
                </p>
              </div>
            </div>
            {preview.count === 0 && (
              <div className="mt-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-xs px-3 py-2">
                {t("import.no_tx_extracted", lang)}
              </div>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
              {preview.closingBalance !== null && (
                <Stat
                  icon={<FileText size={13} />}
                  label={t("import.statement_balance", lang)}
                  value={formatBRL(preview.closingBalance)}
                />
              )}
              {preview.periodStart && preview.periodEnd && (
                <Stat
                  icon={<FileText size={13} />}
                  label={t("import.period", lang)}
                  value={`${formatDate(preview.periodStart)} → ${formatDate(preview.periodEnd)}`}
                />
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 px-4 py-3 rounded-xl bg-card border border-border text-sm font-medium"
            >
              {t("import.cancel", lang)}
            </button>
            <button
              onClick={confirm}
              disabled={preview.count === 0}
              className="flex-[2] px-4 py-3 rounded-xl bg-accent text-white font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              title={preview.count === 0 ? t("import.no_tx_in_file", lang) : undefined}
            >
              <Sparkles size={16} />
              {preview.count === 0
                ? t("import.no_tx_found", lang)
                : t("import.import_and_cat", lang)}
            </button>
          </div>
        </div>

        {/* RIGHT — preview table */}
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">{t("import.preview_heading", lang)}</h2>
            <p className="text-xs text-muted mt-0.5">
              {lang === "pt"
                ? `Conferindo ${preview.count} lançamento${preview.count !== 1 ? "s" : ""} detectado${preview.count !== 1 ? "s" : ""}`
                : `Reviewing ${preview.count} transaction${preview.count !== 1 ? "s" : ""} detected`}
            </p>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-auto max-h-[480px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border z-10">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted font-medium w-24">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted font-medium">
                    Descrição
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted font-medium w-36">
                    Categoria sugerida
                  </th>
                  <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted font-medium w-28">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.transactions.slice(0, 50).map((tx, i) => (
                  <tr key={i} className="border-t border-border first:border-t-0 hover:bg-bg/50 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted tabular-nums whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-sm truncate max-w-[22ch]">{tx.description}</p>
                      {selectedAccount && (
                        <p className="text-[10px] text-muted mt-0.5">{selectedAccount.type === "credit_card" ? t("import.card_suffix", lang) : selectedAccount.bank}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium whitespace-nowrap">
                        <Sparkles size={10} />
                        {tx.type ?? "A categorizar"}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold text-sm whitespace-nowrap ${tx.amount >= 0 ? "text-accent" : "text-danger"}`}>
                      {tx.amount >= 0 ? "+" : ""}
                      {formatBRL(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-border max-h-[480px] overflow-auto">
            {preview.transactions.slice(0, 50).map((tx, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{tx.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted tabular-nums">{formatDate(tx.date)}</span>
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                      <Sparkles size={9} />
                      {tx.type ?? "A categorizar"}
                    </span>
                  </div>
                </div>
                <span className={`tabular-nums font-semibold text-sm whitespace-nowrap ${tx.amount >= 0 ? "text-accent" : "text-danger"}`}>
                  {tx.amount >= 0 ? "+" : ""}
                  {formatBRL(tx.amount)}
                </span>
              </div>
            ))}
          </div>

          {/* Confirm button at bottom of right column */}
          <div className="px-5 py-4 border-t border-border">
            <button
              onClick={confirm}
              disabled={preview.count === 0}
              className="w-full px-4 py-3 rounded-xl bg-accent text-white font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              title={preview.count === 0 ? t("import.no_tx_in_file", lang) : undefined}
            >
              <Sparkles size={16} />
              {preview.count === 0
                ? t("import.no_tx_found", lang)
                : t("import.import_and_cat", lang)}
            </button>
          </div>
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
          <h2 className="text-lg font-semibold mb-1">{t("import.something_wrong", lang)}</h2>
          <p className="text-sm text-muted mb-4">{err}</p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border text-sm font-medium"
          >
            <RotateCcw size={14} /> {t("import.try_again", lang)}
          </button>
        </div>
      </div>
    );
  }

  // ── Idle (single or multi-select) ─────────────────────────────────────────
  const hasSelectedFiles = file !== null || bulkFiles.length > 0;

  return (
    <div className="grid lg:grid-cols-[2fr_3fr] gap-5 items-start">
      {/* LEFT COLUMN — institution selector + upload */}
      <div className="space-y-4">
        {/* Step 1 — institution / account */}
        <div className="rounded-2xl bg-card border border-border p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-3">
            1 — {t("import.account", lang)}
          </p>
          <div className="space-y-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccountId(a.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                  accountId === a.id
                    ? "border-accent bg-accent/5 text-fg"
                    : "border-border bg-bg text-fg hover:border-accent/40"
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 inline-flex items-center justify-center transition-colors ${
                  accountId === a.id ? "border-accent bg-accent" : "border-border"
                }`}>
                  {accountId === a.id && (
                    <CheckCircle2 size={10} className="text-white" />
                  )}
                </span>
                <span className="flex-1 text-left font-medium truncate">{a.name}</span>
                <span className="text-[10px] text-muted flex-shrink-0">{a.bank}</span>
                {a.type === "credit_card" && (
                  <CreditCard size={12} className="text-muted flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
          {accounts.some((a) => a.type === "credit_card") && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-muted">
              <CreditCard size={10} />
              {t("import.cc_hint", lang)}
            </p>
          )}
        </div>

        {/* Step 2 — drop zone */}
        <div className="space-y-3">
          <label
            className={`block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
              hasSelectedFiles
                ? "border-accent/50 bg-accent/5"
                : "border-border hover:border-accent/40 hover:bg-card"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".ofx,.qfx,.csv,.pdf"
              multiple
              onChange={onFilesSelected}
              className="sr-only"
            />

            {/* Single file selected */}
            {file && !isBulk && (
              <div className="space-y-3">
                <FileText size={32} className="mx-auto text-accent" />
                <div>
                  <p className="font-medium truncate max-w-[22ch] mx-auto">{file.name}</p>
                  <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <p className="text-xs text-muted">{t("import.click_to_change", lang)}</p>
              </div>
            )}

            {/* Multiple files selected */}
            {isBulk && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 justify-center mb-1">
                  <FileText size={24} className="text-accent" />
                  <span className="font-medium">{bulkFiles.length} {t("import.files_selected", lang)}</span>
                </div>
                <div className="max-h-32 overflow-auto text-left space-y-1 px-2">
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
                <p className="text-xs text-muted">{t("import.click_to_change", lang)}</p>
              </div>
            )}

            {/* Empty state */}
            {!hasSelectedFiles && (
              <div className="space-y-3">
                <Upload size={32} className="mx-auto text-muted" />
                <div>
                  <p className="text-sm font-medium">Arraste ou clique para enviar</p>
                  <p className="text-xs text-muted mt-1">Suporta arquivos .CSV, .OFX ou .PDF</p>
                </div>
              </div>
            )}
          </label>

          {/* Pill button — Selecionar Arquivo */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-2.5 rounded-full bg-accent text-white text-sm font-semibold transition hover:bg-accent/90 active:scale-95"
          >
            Selecionar Arquivo
          </button>
        </div>

        {/* Uploaded files card (when files are selected) */}
        {hasSelectedFiles && (
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs uppercase tracking-wider text-muted font-semibold flex-1">Arquivos Carregados</p>
              <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold">
                {file ? 1 : bulkFiles.length}
              </span>
            </div>
            {file && (
              <div className="flex items-center gap-3 text-sm">
                <FileText size={16} className="text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <p className="text-[10px] text-muted">{accounts.find((a) => a.id === accountId)?.bank ?? "—"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setFile(null); setSingleStage("idle"); }}
                  className="text-muted hover:text-danger transition-colors flex-shrink-0"
                  aria-label="Remover arquivo"
                >
                  <XCircle size={16} />
                </button>
              </div>
            )}
            {isBulk && (
              <div className="space-y-2">
                {bulkFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <FileText size={16} className="text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-xs">{f.file.name}</p>
                      <p className="text-[10px] text-muted">{accounts.find((a) => a.id === accountId)?.bank ?? "—"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = bulkFiles.filter((_, idx) => idx !== i);
                        if (next.length === 0) { setBulkFiles([]); }
                        else if (next.length === 1) { setFile(next[0].file); setBulkFiles([]); }
                        else { setBulkFiles(next); }
                      }}
                      className="text-muted hover:text-danger transition-colors flex-shrink-0"
                      aria-label="Remover arquivo"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action button */}
        {isBulk ? (
          <button
            onClick={startBulk}
            disabled={!accountId}
            className="w-full p-3.5 rounded-xl bg-fg text-bg font-medium disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            <Sparkles size={16} /> {t("import.bulk_cta_a", lang)} {bulkFiles.length} {t("import.bulk_cta_b", lang)}
          </button>
        ) : (
          <button
            onClick={upload}
            disabled={!file || !accountId}
            className="w-full p-3.5 rounded-xl bg-fg text-bg font-medium disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            <Sparkles size={16} /> {t("import.single_cta", lang)}
          </button>
        )}

        <p className="text-center text-xs text-muted">
          {t("import.banks_hint", lang)}
          <br />
          {t("import.pdf_hint", lang)}
        </p>
      </div>

      {/* RIGHT COLUMN — placeholder before any file is uploaded */}
      <div className="hidden lg:flex flex-col items-center justify-center rounded-2xl bg-card border border-border p-10 text-center min-h-[300px]">
        <FileText size={40} className="text-muted mb-4 opacity-40" />
        <p className="text-sm font-medium text-muted">Prévia das Transações</p>
        <p className="text-xs text-muted mt-1 opacity-60">Selecione um arquivo para ver a pré-visualização</p>
      </div>
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
  fileName,
  lang
}: {
  stage: SingleStage;
  elapsed: number;
  fileName: string;
  lang: Lang;
}) {
  const steps = [
    { key: "uploading", label: t("import.step_upload", lang), hint: t("import.step_upload_hint", lang) },
    {
      key: "parsing",
      label: t("import.step_parse", lang),
      hint: t("import.step_parse_hint", lang)
    },
    {
      key: "importing",
      label: t("import.step_save", lang),
      hint: t("import.step_save_hint", lang)
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
            <h2 className="font-medium leading-tight">{current?.label ?? t("import.processing", lang)}</h2>
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
        {t("import.dont_close_single", lang)}
      </p>
    </div>
  );
}
