"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  role: "admin" | "health";
  label: string; // "Mickael" | "Ayelet" — used in the confirm dialog
};

// Small inline "Desconectar" link. Admin-only (page-level guard is in the server page).
export function GmailDisconnectButton({ role, label }: Props) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handle() {
    if (!confirm(`Desconectar conta Google de ${label}?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/auth/gmail/disconnect?role=${role}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      className="text-xs text-on-surface-variant hover:text-error transition disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin inline" /> : "Desconectar"}
    </button>
  );
}
