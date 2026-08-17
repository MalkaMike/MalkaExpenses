"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Shows the secretary link and copies the absolute URL.
 *
 * The origin is read in the browser rather than hardcoded, so the copied link
 * is correct on production and on any preview deployment.
 */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context or without permission —
      // say so instead of showing a success state that did nothing.
      setError("Não consegui copiar. Selecione o link acima e copie à mão.");
    }
  }

  return (
    <div className="space-y-2">
      <code className="block text-[11px] break-all text-on-surface bg-surface-container p-2 rounded-lg">
        {path}
      </code>
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:opacity-80 transition"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copiado" : "Copiar link completo"}
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
