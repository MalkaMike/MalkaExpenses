"use client";

import { useState, useRef } from "react";
import { Camera, Loader2, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/format";

// Shared control: scan/upload a doctor's prescription and pair it to a medical
// nota. On mobile the file input opens the camera (capture=environment). The
// scan engine recognizes the document; if it's a prescription it's saved and
// paired to nfId. Used in the nota detail modal and the Health hub.
export function PrescriptionAttach({
  nfId,
  onChanged,
  compact,
}: {
  nfId: string;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    doc_kind?: string;
    paired?: boolean;
    scan?: { prescription?: { doctor_name?: string | null; doctor_crm?: string | null; issue_date?: string | null } };
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file: File) {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
        fr.onerror = () => rej(new Error("falha ao ler o arquivo"));
        fr.readAsDataURL(file);
      });
      const r = await fetch("/api/admin/health/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: b64,
          mime_type: file.type || "application/pdf",
          link_nota_fiscal_id: nfId,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falha no reconhecimento");
      setResult(data);
      if (data.paired) onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const presc = result?.scan?.prescription;

  return (
    <div className={compact ? "" : "px-5 py-4"}>
      {!compact && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
          Pedido médico
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 text-primary font-medium hover:bg-primary/5 transition disabled:opacity-50 ${
          compact ? "py-1.5 text-xs" : "py-2.5 text-sm"
        }`}
      >
        {busy ? <Loader2 size={compact ? 13 : 15} className="animate-spin" /> : <Camera size={compact ? 13 : 15} />}
        {busy ? "Lendo documento…" : "Escanear / anexar pedido médico"}
      </button>

      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}

      {result && result.doc_kind === "prescription" && (
        <div className="mt-3 p-3 rounded-lg bg-[#10b981]/5 border border-[#10b981]/20 space-y-1">
          <p className="text-[11px] text-[#10b981] font-semibold flex items-center gap-1">
            <CheckCircle2 size={12} /> {result.paired ? "Pedido vinculado a esta nota" : "Pedido reconhecido"}
          </p>
          {presc?.doctor_name && (
            <p className="text-[11px] text-on-surface">
              Dr(a). {presc.doctor_name}
              {presc.doctor_crm ? ` · CRM ${presc.doctor_crm}` : ""}
            </p>
          )}
          {presc?.issue_date && (
            <p className="text-[10px] text-on-surface-variant">{formatDate(presc.issue_date.slice(0, 10))}</p>
          )}
        </div>
      )}
      {result && result.doc_kind !== "prescription" && (
        <p className="text-[11px] text-[#f59e0b] mt-2">
          Documento reconhecido como “{result.doc_kind}”, não um pedido médico. Tente outra foto.
        </p>
      )}
    </div>
  );
}
