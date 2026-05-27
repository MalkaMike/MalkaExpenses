"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/household/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!r.ok) {
        setErr("Senha incorreta");
        return;
      }
      router.replace(next || "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-5">
      <h2 className="text-center text-2xl font-semibold">
        {process.env.NEXT_PUBLIC_APP_NAME || "Casa"}
      </h2>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="senha"
        className="w-full p-4 rounded-xl bg-card border border-border text-center"
      />
      {err && <p className="text-center text-sm text-danger">{err}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full p-3 rounded-xl bg-fg text-bg disabled:opacity-40 font-medium"
      >
        {busy ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
