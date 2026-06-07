import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { scanDocument } from "@/lib/ai/scan";
import { recomputeOne } from "@/lib/eligibility/recompute";
import { maybeQueueSecretaryEmail } from "@/lib/health/lifecycle";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

function tokens(name: string): string[] {
  const n = (name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  return n.split(/[^A-Z0-9]+/).filter((w) => w.length >= 4);
}

type CandidateNf = {
  id: string;
  provider_name: string | null;
  patient_name: string | null;
  total_amount: number | null;
  emission_date: string | null;
  has_payment: boolean;
};

async function fetchCandidates(sb: ReturnType<typeof serverClient>): Promise<CandidateNf[]> {
  // NFs that are reimbursable and do not yet have a prescription attached.
  const { data } = await sb
    .from("nota_fiscais")
    .select(
      "id, provider_name, patient_name, total_amount, emission_date, payment_status, reimbursement_claims(prescription_id)"
    )
    .eq("is_reimbursable", true)
    .order("emission_date", { ascending: false })
    .limit(60);

  return (data ?? [])
    .filter((nf) => {
      const claim = Array.isArray(nf.reimbursement_claims)
        ? nf.reimbursement_claims[0]
        : nf.reimbursement_claims;
      return !claim?.prescription_id;
    })
    .slice(0, 20)
    .map((nf) => ({
      id: nf.id,
      provider_name: nf.provider_name,
      patient_name: nf.patient_name,
      total_amount: nf.total_amount != null ? Number(nf.total_amount) : null,
      emission_date: nf.emission_date,
      has_payment: ["paid_full", "paying"].includes(nf.payment_status ?? ""),
    }));
}

// POST /api/admin/health/scan
// Body: { base64, mime_type, link_nota_fiscal_id? }
//
// Behavior:
//   - ALWAYS saves the file and creates a medical_documents row — regardless of
//     what the AI classification returns. The user knows they're scanning a
//     prescription; AI metadata extraction is best-effort only.
//   - When link_nota_fiscal_id is provided: links immediately and fires downstream
//     (recompute + email queue). Returns { paired: true }.
//   - When link_nota_fiscal_id is absent: returns the saved medical_document_id
//     plus a candidates[] list of medical NFs still needing a prescription, so
//     the frontend can show a picker and let the user manually choose.
//   - Nota fiscal recognition (when the scanned doc is an NF): unchanged — checks
//     bank transactions and returns payment match info.
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: { base64?: string; mime_type?: string; link_nota_fiscal_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { base64, mime_type, link_nota_fiscal_id } = body;
  if (!base64 || !mime_type) {
    return NextResponse.json({ error: "base64 and mime_type required" }, { status: 400 });
  }

  // Run Gemini scan — best-effort metadata extraction; never blocks saving.
  let scan: Awaited<ReturnType<typeof scanDocument>>;
  try {
    scan = await scanDocument(base64, mime_type);
  } catch (e) {
    // Even if the AI fails, continue — we still save the file.
    scan = { doc_kind: "other", confidence: "low", nota_fiscal: null, prescription: null, raw_text: null } as unknown as typeof scan;
    console.warn("[scan] Gemini failed, continuing with empty metadata:", (e as Error).message);
  }

  // Persist the file to disk (Phase 4 will migrate to Supabase Storage).
  const id = randomUUID();
  const ext = EXT[mime_type] ?? "bin";
  let filePath: string | null = null;
  try {
    const dir = join(process.cwd(), "private", "medical-docs");
    await mkdir(dir, { recursive: true });
    filePath = join("private", "medical-docs", `${id}.${ext}`);
    await writeFile(join(process.cwd(), filePath), Buffer.from(base64, "base64"));
  } catch {
    filePath = null;
  }

  const sb = serverClient();

  // ── Prescription: save regardless of AI classification ────────────────────
  // The user is always scanning a prescription from this endpoint (the nota
  // fiscal path is a separate branch below). doc_kind from AI is metadata only.
  if (scan.doc_kind !== "nota_fiscal") {
    const p = scan.prescription ?? null;
    const { data: doc, error } = await sb
      .from("medical_documents")
      .insert({
        doc_type: "prescription",
        patient_name: p?.patient_name ?? null,
        doctor_name: p?.doctor_name ?? null,
        doctor_crm: p?.doctor_crm ?? null,
        issue_date: p?.issue_date ?? null,
        description: p?.description ?? null,
        file_path: filePath,
        raw_text: scan.raw_text ?? null,
        source: "mobile_scan",
      })
      .select("id")
      .single();
    if (error || !doc) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

    let paired = false;
    if (link_nota_fiscal_id) {
      // Direct-link mode: the caller already knows which NF this belongs to.
      const { data: existing } = await sb
        .from("reimbursement_claims")
        .select("id")
        .eq("nota_fiscal_id", link_nota_fiscal_id)
        .maybeSingle();
      if (existing) {
        await sb.from("reimbursement_claims")
          .update({ prescription_id: doc.id })
          .eq("id", existing.id);
      } else {
        await sb.from("reimbursement_claims").insert({
          nota_fiscal_id: link_nota_fiscal_id,
          prescription_id: doc.id,
          determined_by: "manual",
        });
      }
      paired = true;

      void recomputeOne(link_nota_fiscal_id).catch((e) =>
        console.warn("[scan→recompute]", link_nota_fiscal_id, (e as Error).message)
      );
      void maybeQueueSecretaryEmail(link_nota_fiscal_id).then((r) => {
        if (!r.ok) console.warn("[scan→queue-email]", link_nota_fiscal_id, r.detail);
        else if (r.action === "queued") console.log("[scan→queue-email] queued", link_nota_fiscal_id);
      });

      return NextResponse.json({
        doc_kind: scan.doc_kind,
        medical_document_id: doc.id,
        paired,
        scan,
      });
    }

    // Picker mode: return the saved doc id + candidates for the UI to show.
    const candidates = await fetchCandidates(sb);
    return NextResponse.json({
      doc_kind: scan.doc_kind,
      medical_document_id: doc.id,
      paired: false,
      scan,
      candidates,
    });
  }

  // ── Nota fiscal: recognize + confirm payment against bank transactions ────
  if (scan.doc_kind === "nota_fiscal" && scan.nota_fiscal) {
    const nf = scan.nota_fiscal;
    let payment: { matched: boolean; transaction?: unknown } = { matched: false };
    if (nf.total_amount && nf.emission_date) {
      const A = Number(nf.total_amount);
      const d = new Date(nf.emission_date);
      const from = new Date(d.getTime() - 20 * 86400000).toISOString().slice(0, 10);
      const to = new Date(d.getTime() + 20 * 86400000).toISOString().slice(0, 10);
      const { data: txs } = await sb
        .from("transactions")
        .select("id, date, description_clean, real_amount")
        .gte("date", from)
        .lte("date", to)
        .lt("real_amount", 0)
        .eq("is_fake", false);
      const provTokens = tokens(nf.provider_name ?? "");
      const cand = (txs ?? []).filter((t) => {
        const amt = Math.abs(Number(t.real_amount));
        const amtOk = Math.abs(amt - A) <= Math.max(5, A * 0.05);
        const desc = (t.description_clean ?? "").toUpperCase();
        const merchOk = provTokens.some((tok) => desc.includes(tok));
        return amtOk && (merchOk || provTokens.length === 0);
      });
      if (cand.length > 0) {
        cand.sort(
          (a, b) =>
            Math.abs(new Date(a.date).getTime() - d.getTime()) -
            Math.abs(new Date(b.date).getTime() - d.getTime())
        );
        payment = { matched: true, transaction: cand[0] };
      }
    }
    return NextResponse.json({ doc_kind: "nota_fiscal", file_path: filePath, scan, payment });
  }

  return NextResponse.json({ doc_kind: scan.doc_kind, scan, note: "unrecognized document" });
}
