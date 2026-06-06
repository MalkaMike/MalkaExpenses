import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { scanDocument } from "@/lib/ai/scan";
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

// POST /api/admin/health/scan
// Body: { base64, mime_type, link_nota_fiscal_id? }
// Recognizes a scanned nota fiscal or prescription. Prescriptions are saved and
// (if link_nota_fiscal_id given) paired to that medical nota. Notas fiscais are
// recognized + checked against bank transactions ("paid or not").
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

  let scan;
  try {
    scan = await scanDocument(base64, mime_type);
  } catch (e) {
    return NextResponse.json({ error: `scan failed: ${(e as Error).message}` }, { status: 500 });
  }

  // Persist the scanned image to disk (local). Prod storage -> Supabase Storage (TODO).
  const id = randomUUID();
  const ext = EXT[mime_type] ?? "bin";
  let filePath: string | null = null;
  try {
    const dir = join(process.cwd(), "private", "medical-docs");
    await mkdir(dir, { recursive: true });
    filePath = join("private", "medical-docs", `${id}.${ext}`);
    await writeFile(join(process.cwd(), filePath), Buffer.from(base64, "base64"));
  } catch {
    filePath = null; // non-fatal; structured data is what matters
  }

  const sb = serverClient();

  // ── Prescription: save + pair to the medical nota ─────────────────────────
  if (scan.doc_kind === "prescription" && scan.prescription) {
    const p = scan.prescription;
    const { data: doc, error } = await sb
      .from("medical_documents")
      .insert({
        doc_type: "prescription",
        patient_name: p.patient_name ?? null,
        doctor_name: p.doctor_name ?? null,
        doctor_crm: p.doctor_crm ?? null,
        issue_date: p.issue_date ?? null,
        description: p.description ?? null,
        file_path: filePath,
        raw_text: scan.raw_text ?? null,
        source: "mobile_scan",
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let paired = false;
    if (link_nota_fiscal_id) {
      // Upsert a claim pairing this prescription to the medical nota.
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
    }
    return NextResponse.json({ doc_kind: "prescription", medical_document_id: doc.id, paired, scan });
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
