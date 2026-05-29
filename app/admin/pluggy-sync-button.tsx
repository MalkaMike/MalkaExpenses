"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, ChevronRight, Loader2 } from "lucide-react";

// Admin tool: re-pull transactions for every connected Pluggy bank.
export function PluggySyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const tid = toast.loading("Sincronizando bancos…");
    try {
      const r = await fetch("/api/pluggy/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) {
        toast.error("Open Finance não configurado (faltam as chaves Pluggy).", { id: tid });
        return;
      }
      if (!r.ok) {
        toast.error(j.error ?? "Falha ao sincronizar.", { id: tid });
        return;
      }
      if ((j.items ?? 0) === 0) {
        toast.success("Nenhum banco conectado ainda.", { id: tid });
      } else {
        toast.success(
          `${j.inserted ?? 0} novas · ${j.items} banco(s) · ${j.reconciled ?? 0} fatura(s) vinculada(s)`,
          { id: tid }
        );
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="w-full text-left block p-4 rounded-xl bg-card border border-border active:scale-[0.99] hover:border-accent/40 transition disabled:opacity-60"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-bg/60 inline-flex items-center justify-center text-muted">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Sincronizar bancos</p>
          <p className="text-xs text-muted truncate">
            Puxar novas transações das conexões Open Finance
          </p>
        </div>
        <ChevronRight size={16} className="text-muted" />
      </div>
    </button>
  );
}
