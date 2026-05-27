import Link from "next/link";
import { ChevronLeft, FileText, Download, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { serverClient } from "@/lib/supabase/server";
import { formatBRL, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "ok" | "warn" | "neutral"; Icon: typeof CheckCircle2 }> = {
  imported: { label: "Importado", tone: "ok", Icon: CheckCircle2 },
  parsed: { label: "Analisado", tone: "neutral", Icon: Clock },
  uploaded: { label: "Enviado", tone: "neutral", Icon: Clock },
  failed: { label: "Erro", tone: "warn", Icon: AlertCircle }
};

export default async function ArchivePage() {
  const sb = serverClient();

  const { data: rows } = await sb
    .from("statement_imports")
    .select(
      "id, account_id, file_name, file_type, storage_path, parsed_at, transaction_count, status, closing_balance, due_date, uploaded_at, accounts(name, bank)"
    )
    .order("uploaded_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string;
    account_id: string;
    file_name: string | null;
    file_type: string;
    storage_path: string | null;
    parsed_at: string | null;
    transaction_count: number | null;
    status: string;
    closing_balance: number | null;
    due_date: string | null;
    uploaded_at: string;
    accounts: { name: string; bank: string } | { name: string; bank: string }[] | null;
  };

  const imports = ((rows ?? []) as Row[]).map((r) => ({
    ...r,
    account: Array.isArray(r.accounts) ? r.accounts[0] : r.accounts
  }));

  // Generate signed URLs in batch for download links (valid 1h)
  const signedUrls = new Map<string, string>();
  if (imports.length > 0) {
    const paths = imports.filter((r) => r.storage_path).map((r) => r.storage_path!);
    if (paths.length > 0) {
      const { data: signedList } = await sb.storage
        .from("statements")
        .createSignedUrls(paths, 3600);
      for (const s of signedList ?? []) {
        if (s.path && s.signedUrl) signedUrls.set(s.path, s.signedUrl);
      }
    }
  }

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Arquivos importados</h1>
        <p className="text-xs text-muted">
          Todos os extratos enviados — originais preservados no Storage.
        </p>
      </header>

      {imports.length === 0 && (
        <div className="rounded-2xl bg-card border border-dashed border-border p-8 text-center">
          <FileText size={28} className="mx-auto text-muted mb-2" />
          <p className="text-sm text-muted">
            Nenhum extrato importado ainda.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {imports.map((r) => {
          const meta = STATUS_META[r.status] ?? STATUS_META.uploaded;
          const StatusIcon = meta.Icon;
          const url = r.storage_path ? signedUrls.get(r.storage_path) : null;
          return (
            <li
              key={r.id}
              className="rounded-xl bg-card border border-border p-3"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-xl inline-flex items-center justify-center shrink-0 ${
                    meta.tone === "ok"
                      ? "bg-accent/10 text-accent"
                      : meta.tone === "warn"
                        ? "bg-danger/10 text-danger"
                        : "bg-muted/10 text-muted"
                  }`}
                >
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className="font-medium truncate">{r.file_name ?? "(sem nome)"}</p>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider whitespace-nowrap ${
                        meta.tone === "ok"
                          ? "text-accent"
                          : meta.tone === "warn"
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      <StatusIcon size={11} /> {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">
                    {r.account?.name ?? "—"} · {r.file_type.toUpperCase()} ·{" "}
                    {r.transaction_count ?? 0} mov · {formatDate(r.uploaded_at.slice(0, 10))}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted">
                    {r.closing_balance !== null && (
                      <span className="tabular-nums">
                        saldo: {formatBRL(Number(r.closing_balance))}
                      </span>
                    )}
                    {r.due_date && (
                      <span>vencimento: {formatDate(r.due_date)}</span>
                    )}
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <Download size={11} /> abrir original
                      </a>
                    ) : r.storage_path ? (
                      <span className="text-muted/60">arquivo indisponível</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
