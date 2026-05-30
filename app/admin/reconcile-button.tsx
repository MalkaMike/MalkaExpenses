"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, ChevronRight, Loader2 } from "lucide-react";

// Admin tool: scan existing bank outflows and mark credit-card bill payments
// as transfers (so they don't double-count against the card's own line items).
export function ReconcileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error ?? "erro ao reconciliar");
        return;
      }
      const j = (await r.json()) as {
        scanned: number;
        autoLinked: number;
        needsReview: unknown[];
      };
      if (j.autoLinked === 0) {
        toast.success(
          j.scanned === 0
            ? "Nenhum pagamento de cartão encontrado"
            : "Tudo já marcado"
        );
      } else {
        toast.success(
          `${j.autoLinked} pagamento${j.autoLinked === 1 ? "" : "s"} de cartão marcado${j.autoLinked === 1 ? "" : "s"} como transferência`
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
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowLeftRight size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Marcar pagamentos de cartão</p>
          <p className="text-xs text-muted truncate">
            Detecta pagamentos de fatura e marca como transferência (evita contar 2×)
          </p>
        </div>
        <ChevronRight size={16} className="text-muted" />
      </div>
    </button>
  );
}
