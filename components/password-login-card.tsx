"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Loader2 } from "lucide-react";

type Props = {
  // What this card is logging into
  variant: "household" | "admin";
  // POST endpoint for the password submission
  endpoint: string;
  // Where to send the user on success
  defaultNext: string;
  // Optional override for "next" search param
  next?: string;
};

const COPY = {
  household: {
    title: "Casa",
    subtitle: "Suas finanças, juntos",
    placeholder: "senha de casa",
    icon: null
  },
  admin: {
    title: "Admin",
    subtitle: "Acesso privado",
    placeholder: "senha admin",
    icon: Lock
  }
} as const;

export function PasswordLoginCard({ variant, endpoint, defaultNext, next }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const copy = COPY[variant];
  const IconComp = copy.icon;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!r.ok) {
        setErr("Senha incorreta");
        setShake(true);
        setTimeout(() => setShake(false), 500);
        // Don't clear the password — user may want to fix a typo
        return;
      }
      router.replace(next || defaultNext);
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
          {IconComp && (
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-danger/10 text-danger mb-2">
              <IconComp size={20} />
            </div>
          )}
          <h1 className="text-3xl font-semibold tracking-tight">
            {variant === "household"
              ? process.env.NEXT_PUBLIC_APP_NAME || copy.title
              : copy.title}
          </h1>
          <p className="text-sm text-muted">{copy.subtitle}</p>
        </header>

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoFocus
              autoComplete="current-password"
              inputMode="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (err) setErr(null);
              }}
              placeholder={copy.placeholder}
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
            {err ?? " "}
          </div>

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className={`relative w-full py-3.5 rounded-xl font-medium text-base transition
              ${busy || password.length === 0
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

      {variant === "household" && (
        <p className="mt-6 text-center text-xs text-muted">
          esqueceu? pergunte ao Mickael
        </p>
      )}

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
