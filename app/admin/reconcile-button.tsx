"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, ChevronRight, Loader2 } from "lucide-react";

// Admin tool: run the CC reconciliation scan over all existing bank payments.
// Auto-links unambiguous matches; reports how many were linked / need review.
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
      const review = Array.isArray(j.needsReview) ? j.needsReview.length : 0;
      if (j.autoLinked === 0 && review === 0) {
        toast.success(
          j.scanned === 0
            ? "Nenhum pagamento de cartão encontrado"
            : "Tudo já reconciliado"
        );
      } else {
        toast.success(
          `${j.autoLinked} vinculado${j.autoLinked === 1 ? "" : "s"}` +
            (review > 0 ? ` · ${review} para rever manualmente` : "")
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
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Reconciliar faturas</p>
          <p className="text-xs text-muted truncate">
            Vincular pagamentos de cartão às faturas (evita contar 2×)
          </p>
        </div>
        <ChevronRight size={16} className="text-muted" />
      </div>
    </button>
  );
}
