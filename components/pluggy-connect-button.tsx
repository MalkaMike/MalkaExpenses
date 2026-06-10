"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Landmark, Loader2 } from "lucide-react";
import { safeJson } from "@/lib/http";

// The widget touches `window`, so load it client-only.
const PluggyConnect = dynamic(
  () => import("react-pluggy-connect").then((m) => m.PluggyConnect),
  { ssr: false }
);

type ConnectedItem = { id: string };

export function PluggyConnectButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const r = await fetch("/api/pluggy/connect-token", { method: "POST" });
      if (r.status === 503) {
        toast.error("Open Finance ainda não configurado (faltam as chaves Pluggy).");
        return;
      }
      if (!r.ok) {
        toast.error("Não consegui iniciar a conexão.");
        return;
      }
      const { connectToken } = (await r.json()) as { connectToken: string };
      setToken(connectToken);
    } finally {
      setBusy(false);
    }
  }

  async function onSuccess({ item }: { item: ConnectedItem }) {
    setToken(null);
    const tid = toast.loading("Sincronizando transações…");
    try {
      const r = await fetch("/api/pluggy/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id })
      });
      const j = await safeJson(r);
      if (!r.ok) {
        toast.error(j.error ?? "Falha ao sincronizar.", { id: tid });
        return;
      }
      toast.success(
        `${j.inserted ?? 0} transações importadas · ${j.accounts ?? 0} conta(s) conectada(s)`,
        { id: tid }
      );
      router.refresh();
    } catch {
      toast.error("Falha ao sincronizar.", { id: tid });
    }
  }

  return (
    <>
      <button
        onClick={open}
        disabled={busy}
        className="w-full p-4 rounded-xl bg-accent text-white font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Landmark size={18} />}
        Conectar banco automaticamente
      </button>

      {token && (
        <PluggyConnect
          connectToken={token}
          includeSandbox
          theme="light"
          onSuccess={onSuccess}
          onClose={() => setToken(null)}
          onError={() => {
            toast.error("Conexão cancelada ou com erro.");
            setToken(null);
          }}
        />
      )}
    </>
  );
}
