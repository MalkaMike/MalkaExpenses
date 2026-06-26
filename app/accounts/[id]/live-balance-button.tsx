"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatBRL } from "@/lib/format";

export function LiveBalanceButton({ pluggyAccountId }: { pluggyAccountId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [balance, setBalance] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/pluggy/balance?accountId=${encodeURIComponent(pluggyAccountId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setBalance(data.balance);
      setUpdatedAt(data.updateDateTime ?? null);
      setState("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro desconhecido");
      setState("error");
    }
  }

  return (
    <div className="mt-2">
      {state === "done" && balance !== null && (
        <p className="text-sm font-semibold tabular-nums text-secondary mb-1">
          Saldo ao vivo: {formatBRL(balance)}
          {updatedAt && (
            <span className="text-xs font-normal text-on-surface-variant ml-2">
              atualizado {new Date(updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
      )}
      {state === "error" && errorMsg && (
        <p className="text-xs text-error mb-1">
          {errorMsg.includes("429") ? "Limite do banco atingido — tente em alguns minutos" : errorMsg.slice(0, 80)}
        </p>
      )}
      <button
        onClick={refresh}
        disabled={state === "loading"}
        className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition disabled:opacity-50"
      >
        <RefreshCw size={12} className={state === "loading" ? "animate-spin" : ""} />
        {state === "loading" ? "Buscando..." : "Atualizar saldo ao vivo"}
      </button>
    </div>
  );
}
