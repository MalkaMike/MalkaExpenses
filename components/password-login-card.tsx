"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

type Props = { next?: string };

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
      const defaultDest =
        data.role === "admin" ? "/admin"
        : data.role === "health" ? "/admin/health"
        : data.role === "secretary" ? "/admin/health/queue"
        : "/";
      router.replace(next ?? defaultDest);
      router.refresh();
    } catch {
      setErr("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`w-full max-w-sm mx-auto transition-transform ${
        shake ? "animate-[shake_0.4s_ease-in-out]" : ""
      }`}
    >
      {/* Brand mark */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-on-surface/5 mb-4">
          <span className="font-display font-bold text-xl text-on-surface">M</span>
        </div>
        <h1 className="font-display font-semibold text-2xl text-on-surface tracking-tight">
          {process.env.NEXT_PUBLIC_APP_NAME || "Casa"}
        </h1>
        <p className="text-sm mt-1" style={{ color: "#75777c" }}>
          Suas finanças, juntos
        </p>
      </div>

      {/* Card */}
      <div
        className="rounded-2xl p-7 space-y-4"
        style={{
          background: "#ffffff",
          border: "1px solid #e9e8e6",
          boxShadow: "0 4px 24px rgba(24,29,37,0.06)"
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          {/* Username */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#45474b", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Login
            </label>
            <input
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (err) setErr(null); }}
              placeholder="Malka"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition"
              style={{
                background: "#f4f3f1",
                border: `1px solid ${err ? "#ba1a1a" : "#e9e8e6"}`,
                color: "#1a1c1b"
              }}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#45474b", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Senha
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (err) setErr(null); }}
                placeholder="••••••••"
                className="w-full pl-4 pr-12 py-3 rounded-xl text-sm outline-none transition"
                style={{
                  background: "#f4f3f1",
                  border: `1px solid ${err ? "#ba1a1a" : "#e9e8e6"}`,
                  color: "#1a1c1b"
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition hover:opacity-60"
                style={{ color: "#75777c" }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          <div
            className={`text-sm min-h-[1.25rem] transition-opacity ${err ? "opacity-100" : "opacity-0"}`}
            role="alert"
            aria-live="polite"
            style={{ color: "#ba1a1a" }}
          >
            {err ?? " "}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="relative w-full py-3.5 rounded-xl text-sm font-semibold transition active:scale-[0.99]"
            style={{
              background: !username || !password || busy ? "#e9e8e6" : "#181d25",
              color: !username || !password || busy ? "#75777c" : "#ffffff",
              cursor: !username || !password || busy ? "not-allowed" : "pointer"
            }}
          >
            <span className={busy ? "opacity-0" : "opacity-100"}>Entrar</span>
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin" />
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
