"use client";

import { useState, useRef } from "react";
import { Camera, Loader2, CheckCircle2, Wallet, ChevronRight } from "lucide-react";
import { formatBRL, formatDate } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// PrescriptionAttach
//
// Two modes determined by the optional `nfId` prop:
//
//   Direct (nfId provided): user is already inside a specific NF row.
//     Upload → AI scan + immediate link → done. No picker shown.
//
//   Picker (nfId absent): user is scanning a loose prescription.
//     Upload → AI saves file → show list of NFs still needing a prescription
//     → user taps to link → done.
//
// The AI scan result is always best-effort metadata (doctor name / date).
// It never blocks saving or linking — handwritten prescriptions are expected.
// ─────────────────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  provider_name: string | null;
  patient_name: string | null;
  total_amount: number | null;
  emission_date: string | null;
  has_payment: boolean;
};

type ScanMeta = {
  doctor_name?: string | null;
  doctor_crm?: string | null;
  issue_date?: string | null;
};

type Step = "idle" | "uploading" | "picking" | "linking" | "done";

export function PrescriptionAttach({
  nfId,
  onChanged,
  compact,
}: {
  nfId?: string;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [scanMeta, setScanMeta] = useState<ScanMeta | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStep("uploading");
    setErr(null);
    setScanMeta(null);
    setDocId(null);
    setCandidates([]);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
        fr.onerror = () => rej(new Error("falha ao ler o arquivo"));
        fr.readAsDataURL(file);
      });
      const body: Record<string, string> = {
        base64: b64,
        mime_type: file.type || "application/pdf",
      };
      if (nfId) body.link_nota_fiscal_id = nfId;

      const r = await fetch("/api/admin/health/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falha ao salvar o arquivo");

      // Capture AI metadata (optional — may be null for handwritten docs)
      setScanMeta(data.scan?.prescription ?? null);

      if (nfId) {
        // Direct mode: scan route already linked it
        setStep("done");
        onChanged();
      } else {
        // Picker mode: show candidate NFs
        setDocId(data.medical_document_id ?? null);
        setCandidates(data.candidates ?? []);
        setStep("picking");
      }
    } catch (e) {
      setErr((e as Error).message);
      setStep("idle");
    }
  }

  async function linkTo(candidateNfId: string) {
    if (!docId) return;
    setStep("linking");
    setErr(null);
    try {
      const r = await fetch("/api/admin/health/prescriptions/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medical_document_id: docId, nota_fiscal_id: candidateNfId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "falha ao vincular");
      setStep("done");
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
      setStep("picking");
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className={`${compact ? "" : "px-5 py-4"} flex flex-col gap-1`}>
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#10b981]/5 border border-[#10b981]/20">
          <CheckCircle2 size={13} className="text-[#10b981] shrink-0" />
          <p className="text-[11px] text-[#10b981] font-semibold">Pedido vinculado</p>
        </div>
        {scanMeta?.doctor_name && (
          <p className="text-[11px] text-on-surface-variant px-0.5">
            Dr(a). {scanMeta.doctor_name}
            {scanMeta.doctor_crm ? ` · CRM ${scanMeta.doctor_crm}` : ""}
            {scanMeta.issue_date ? ` · ${formatDate(scanMeta.issue_date.slice(0, 10))}` : ""}
          </p>
        )}
      </div>
    );
  }

  // ── Picking ─────────────────────────────────────────────────────────────────
  if (step === "picking") {
    return (
      <div className={compact ? "" : "px-5 py-4"}>
        <p className={`font-semibold text-on-surface mb-2 ${compact ? "text-[11px]" : "text-xs"}`}>
          A qual nota este pedido pertence?
        </p>
        {scanMeta?.doctor_name && (
          <p className="text-[10px] text-on-surface-variant mb-2">
            Reconhecido: Dr(a). {scanMeta.doctor_name}
            {scanMeta.doctor_crm ? ` · CRM ${scanMeta.doctor_crm}` : ""}
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="text-[11px] text-on-surface-variant py-2">
            Nenhuma nota aguarda pedido médico.
          </p>
        ) : (
          <div className="rounded-lg border border-outline-variant overflow-hidden divide-y divide-outline-variant">
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => linkTo(c.id)}
                className="w-full px-3 py-2.5 text-left hover:bg-surface-container transition flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-on-surface truncate">
                    {c.provider_name ?? "—"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-on-surface-variant">
                      {c.emission_date ? formatDate(c.emission_date.slice(0, 10)) : "—"}
                    </span>
                    {c.patient_name && c.patient_name !== "Mickael" && (
                      <span className="text-[10px] text-on-surface-variant">· {c.patient_name}</span>
                    )}
                    {c.has_payment ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-[#10b981]">
                        <Wallet size={8} />
                        Pago
                      </span>
                    ) : (
                      <span className="text-[9px] text-on-surface-variant/50">Aguarda pagamento</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className="text-[11px] tabular-nums font-semibold text-on-surface">
                    {formatBRL(Number(c.total_amount ?? 0))}
                  </span>
                  <ChevronRight size={13} className="text-on-surface-variant" />
                </div>
              </button>
            ))}
          </div>
        )}
        {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
        <button
          onClick={() => { setStep("idle"); setDocId(null); setCandidates([]); }}
          className="mt-2 text-[10px] text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    );
  }

  // ── Idle / Uploading ────────────────────────────────────────────────────────
  const busy = step === "uploading" || step === "linking";
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
          if (f) handleFile(f);
          // Reset input so the same file can be re-selected after cancel
          e.target.value = "";
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
        {busy
          ? <Loader2 size={compact ? 13 : 15} className="animate-spin" />
          : <Camera size={compact ? 13 : 15} />}
        {busy ? "Salvando documento…" : "Escanear / anexar pedido médico"}
      </button>
      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
    </div>
  );
}
