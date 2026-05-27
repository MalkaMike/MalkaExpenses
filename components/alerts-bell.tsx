"use client";
import { useState, useEffect, useRef } from "react";
import { Bell, X, Clock, AlertTriangle, FileX, ShieldCheck } from "lucide-react";
import Link from "next/link";

type MissingMonth = {
  account_id: string;
  account_name: string;
  missing: string[];
};

type FailedImport = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

type AlertData = {
  total: number;
  pending_review: number;
  missing_months: MissingMonth[];
  failed_imports: FailedImport[];
};

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit"
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h atrás";
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AlertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch on mount + every 60 seconds
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await fetch("/api/health/alerts");
        if (!mounted) return;
        if (r.status === 401) {
          // Lost auth — don't retry, just show nothing (user will see login redirect on next navigation)
          setFetchErr("auth");
          return;
        }
        if (r.ok) {
          setData(await r.json());
          setFetchErr(null);
        } else {
          console.error("[alerts-bell] unexpected status:", r.status);
          setFetchErr("error");
        }
      } catch (e) {
        console.error("[alerts-bell] network error:", e);
        if (mounted) setFetchErr("error");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const count = data?.total ?? 0;

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-xl text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border transition"
        aria-label="Alertas"
      >
        <Bell size={18} />
        {!loading && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-danger text-bg text-[9px] font-bold flex items-center justify-center tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Alertas</span>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {/* All clear */}
            {!loading && count === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
                <ShieldCheck size={28} className="text-accent" />
                <p className="text-sm font-medium">Tudo em ordem!</p>
                <p className="text-xs text-muted">Nenhum alerta no momento.</p>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="py-6 text-center text-sm text-muted">A verificar…</div>
            )}

            {/* Error state */}
            {!loading && fetchErr && (
              <div className="py-6 text-center text-sm text-muted px-4">
                {fetchErr === "auth"
                  ? "Sessão expirada. Recarregue a página."
                  : "Erro ao carregar alertas."}
              </div>
            )}

            {/* Pending review */}
            {(data?.pending_review ?? 0) > 0 && (
              <Link
                href="/admin/review"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 px-4 py-3 hover:bg-bg/50 transition group"
              >
                <Clock size={16} className="text-warning mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium group-hover:text-accent transition">
                    {data!.pending_review} transações para rever
                  </p>
                  <p className="text-xs text-muted">Categorias com baixa confiança da IA</p>
                </div>
              </Link>
            )}

            {/* Missing months */}
            {(data?.missing_months ?? []).length > 0 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <AlertTriangle size={11} /> Meses em falta
                </p>
                {data!.missing_months.map((acc) => (
                  <Link
                    key={acc.account_id}
                    href={`/accounts/${acc.account_id}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl bg-bg border border-border p-2.5 hover:border-warning/50 transition"
                  >
                    <p className="text-sm font-medium truncate">{acc.account_name}</p>
                    <p className="text-[11px] text-warning mt-0.5">
                      {acc.missing.map(monthLabel).join(", ")}
                    </p>
                  </Link>
                ))}
              </div>
            )}

            {/* Failed imports */}
            {(data?.failed_imports ?? []).length > 0 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <FileX size={11} /> Importações falhadas
                </p>
                {data!.failed_imports.map((fi) => (
                  <div
                    key={fi.id}
                    className="rounded-xl bg-bg border border-danger/20 p-2.5 space-y-0.5"
                  >
                    <p className="text-sm font-medium truncate">{fi.file_name}</p>
                    <p className="text-[11px] text-muted">{timeAgo(fi.uploaded_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
