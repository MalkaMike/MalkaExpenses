"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function UnlockClient({ pinConfigured }: { pinConfigured: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!pinConfigured) {
        if (pin !== pin2) {
          setErr("PINs não conferem");
          return;
        }
        const r = await fetch("/api/mode/setup-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin })
        });
        if (!r.ok) {
          setErr((await r.json()).error ?? "erro");
          return;
        }
      }
      const r = await fetch("/api/mode/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      if (!r.ok) {
        setErr("PIN incorreto");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h2 className="text-center text-sm uppercase tracking-wider text-muted">
          {pinConfigured ? "PIN" : "Definir PIN"}
        </h2>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
          className="w-full text-center text-3xl tracking-widest p-4 rounded-xl bg-card border border-border tabular-nums"
        />
        {!pinConfigured && (
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="confirmar"
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 12))}
            className="w-full text-center text-2xl tracking-widest p-3 rounded-xl bg-card border border-border tabular-nums"
          />
        )}
        {err && <p className="text-center text-sm text-danger">{err}</p>}
        <button
          type="submit"
          disabled={busy || pin.length < 4 || (!pinConfigured && pin2.length < 4)}
          className="w-full p-3 rounded-xl bg-fg text-bg disabled:opacity-40 font-medium"
        >
          {pinConfigured ? "Entrar" : "Definir e entrar"}
        </button>
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="w-full p-2 text-xs text-muted"
        >
          cancelar
        </button>
      </form>
    </div>
  );
}
