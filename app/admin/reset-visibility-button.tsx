"use client";
import { useState } from "react";
import { Eye, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function ResetVisibilityButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setBusy(true);
    setConfirming(false);
    try {
      const r = await fetch("/api/admin/reset-visibility", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "erro");
      toast.success(`${j.affected} transações agora 100% visíveis`);
      setDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Trigger row */}
      <button
        onClick={() => setConfirming(true)}
        disabled={busy || done || confirming}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-container transition-colors disabled:opacity-50 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center shrink-0">
          {busy
            ? <Loader2 size={18} className="animate-spin text-on-surface-variant" />
            : <Eye size={18} className="text-on-surface-variant" />}
        </div>
        <div>
          <p className="font-medium text-sm text-on-surface">
            {done ? "Visibilidade resetada ✓" : "Resetar visibilidade (100%)"}
          </p>
          <p className="text-xs text-on-surface-variant">
            {done ? "Ayelet vê tudo agora" : "shared_amount = real_amount em tudo — ponto zero"}
          </p>
        </div>
      </button>

      {/* Inline confirm panel */}
      {confirming && (
        <div className="mx-4 mb-2 mt-1 rounded-xl border border-error/20 bg-error-container/10 p-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-error-container/30 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={15} className="text-error" />
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface mb-0.5">
                Resetar visibilidade completa?
              </p>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Todas as transações não-fake ficam 100% visíveis para Ayelet —{" "}
                <span className="font-medium text-on-surface">
                  shared_amount = real_amount
                </span>{" "}
                em tudo. Operação irreversível via botão.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={run}
              className="flex-1 py-2 rounded-xl bg-error text-on-error text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition"
            >
              <Eye size={14} />
              Confirmar — resetar tudo
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-4 py-2 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface text-sm transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
