"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

type Props = {
  next?: string;
};

export function PasswordLoginCard({ next }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!r.ok) {
        setErr("Login ou senha incorretos");
        setShake(true);
        setTimeout(() => setShake(false), 500);
        return;
      }
      const data = await r.json();
      router.replace(next ?? (data.role === "admin" ? "/admin" : "/"));
      router.refresh();
    } catch {
      setErr("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`w-full max-w-sm transition-transform ${
        shake ? "animate-[shake_0.4s_ease-in-out]" : ""
      }`}
    >
      <div className="rounded-2xl bg-card border border-border shadow-lg p-7 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {process.env.NEXT_PUBLIC_APP_NAME || "Casa"}
          </h1>
          <p className="text-sm text-muted">Suas finanças, juntos</p>
        </header>

        <form onSubmit={submit} className="space-y-4">
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (err) setErr(null); }}
            placeholder="login"
            className={`w-full px-4 py-3.5 rounded-xl bg-bg border text-base outline-none transition
              ${err ? "border-danger" : "border-border focus:border-accent"}
              placeholder:text-muted/60`}
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (err) setErr(null); }}
              placeholder="senha"
              className={`w-full pl-4 pr-12 py-3.5 rounded-xl bg-bg border text-base outline-none transition
                ${err ? "border-danger" : "border-border focus:border-accent"}
                placeholder:text-muted/60`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted hover:text-fg transition"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div
            className={`text-sm text-danger min-h-[1.25rem] transition-opacity ${
              err ? "opacity-100" : "opacity-0"
            }`}
            role="alert"
            aria-live="polite"
          >
            {err ?? " "}
          </div>

          <button
            type="submit"
            disabled={busy || !username || !password}
            className={`relative w-full py-3.5 rounded-xl font-medium text-base transition
              ${busy || !username || !password
                ? "bg-fg/40 text-bg cursor-not-allowed"
                : "bg-fg text-bg hover:bg-fg/90 active:scale-[0.99]"}`}
          >
            <span className={busy ? "opacity-0" : "opacity-100"}>Entrar</span>
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin" />
              </span>
            )}
          </button>
        </form>
      </div>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}
