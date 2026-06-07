import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { sendEmail, type Attachment } from "@/lib/gmail/send";
import { readFile } from "fs/promises";
import { join } from "path";
import { downloadFile, type StorageBucket } from "@/lib/storage/supabase-storage";

export const runtime = "nodejs";
export const maxDuration = 90;

// ============================================================================
// Outbox worker — picks pending health_email_outbox rows and sends them via
// Gmail (gmail.send scope). Idempotent via the UNIQUE idempotency_key.
//
// Schedule: Vercel cron every 2 minutes (vercel.json).
// Manual trigger: GET /api/cron/health-outbox?force=1 from an authenticated
// admin session (the existing middleware lets /api/cron through with a Vercel
// cron header; in dev we accept admin cookie + ?force=1).
//
// File reads: still local /private/* until Phase 4 migrates to Supabase Storage.
// ============================================================================

const PRIVATE_ROOT = process.cwd();
const MAX_PER_RUN = 5;            // pace ourselves; cron runs every 2 min
const MAX_ATTEMPTS = 6;           // ~ 64 min backoff at the longest tail
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

type OutboxRow = {
  id: string;
  claim_id: string;
  idempotency_key: string;
  to_email: string;
  subject: string;
  body_html: string;
  attempts: number;
  status: string;
};

type ClaimDocs = {
  claim_id: string;
  nf_id: string;
  nf_file_name: string | null;
  nf_file_path: string | null;
  nf_storage_bucket: string | null;
  nf_storage_path: string | null;
  prescription_id: string | null;
  prescription_file_path: string | null;
  prescription_storage_bucket: string | null;
  prescription_storage_path: string | null;
  provider_name: string | null;
  emission_date: string | null;
  total_amount: number | null;
  patient_name: string | null;
};

async function fetchAttachments(docs: ClaimDocs): Promise<Attachment[]> {
  const out: Attachment[] = [];

  // NF PDF — prefer Supabase Storage, fall back to local disk
  if (docs.nf_storage_bucket && docs.nf_storage_path) {
    try {
      const bytes = await downloadFile(docs.nf_storage_bucket as StorageBucket, docs.nf_storage_path);
      out.push({
        filename: docs.nf_file_name ?? `nota_fiscal_${docs.nf_id}.pdf`,
        mime_type: "application/pdf",
        bytes,
      });
    } catch (e) {
      console.warn("[outbox] storage NF read failed", docs.nf_storage_path, (e as Error).message);
    }
  } else if (docs.nf_file_path) {
    try {
      const bytes = await readFile(join(PRIVATE_ROOT, docs.nf_file_path));
      out.push({
        filename: docs.nf_file_name ?? `nota_fiscal_${docs.nf_id}.pdf`,
        mime_type: "application/pdf",
        bytes,
      });
    } catch (e) {
      console.warn("[outbox] local NF file missing", docs.nf_file_path, (e as Error).message);
    }
  }

  // Prescription — prefer Supabase Storage, fall back to local disk
  const prescPath = docs.prescription_storage_path ?? docs.prescription_file_path;
  const prescExt = (prescPath?.split(".").pop() ?? "pdf").toLowerCase();
  const prescMime =
    prescExt === "pdf" ? "application/pdf"
    : prescExt === "jpg" || prescExt === "jpeg" ? "image/jpeg"
    : prescExt === "png" ? "image/png"
    : prescExt === "heic" ? "image/heic"
    : "application/octet-stream";

  if (docs.prescription_storage_bucket && docs.prescription_storage_path) {
    try {
      const bytes = await downloadFile(docs.prescription_storage_bucket as StorageBucket, docs.prescription_storage_path);
      out.push({ filename: `pedido_medico.${prescExt}`, mime_type: prescMime, bytes });
    } catch (e) {
      console.warn("[outbox] storage prescription read failed", docs.prescription_storage_path, (e as Error).message);
    }
  } else if (docs.prescription_file_path) {
    try {
      const bytes = await readFile(join(PRIVATE_ROOT, docs.prescription_file_path));
      out.push({ filename: `pedido_medico.${prescExt}`, mime_type: prescMime, bytes });
    } catch (e) {
      console.warn("[outbox] local prescription file missing", docs.prescription_file_path, (e as Error).message);
    }
  }

  return out;
}

async function loadClaimDocs(claimId: string): Promise<ClaimDocs | null> {
  const sb = serverClient();
  const { data, error } = await sb
    .from("reimbursement_claims")
    .select(
      `id, nota_fiscal_id, prescription_id,
       nota_fiscais(provider_name, emission_date, total_amount, patient_name, file_name, file_path, storage_bucket, storage_path),
       medical_documents(file_path, storage_bucket, storage_path)`
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error || !data) return null;
  type NfRel = { provider_name: string | null; emission_date: string | null; total_amount: number | string | null; patient_name: string | null; file_name: string | null; file_path: string | null; storage_bucket: string | null; storage_path: string | null };
  type MdRel = { file_path: string | null; storage_bucket: string | null; storage_path: string | null };
  const dRow = data as { id: string; nota_fiscal_id: string; prescription_id: string | null; nota_fiscais: NfRel | NfRel[] | null; medical_documents: MdRel | MdRel[] | null };
  const nf = Array.isArray(dRow.nota_fiscais) ? dRow.nota_fiscais[0] : dRow.nota_fiscais;
  const md = Array.isArray(dRow.medical_documents) ? dRow.medical_documents[0] : dRow.medical_documents;
  return {
    claim_id: dRow.id,
    nf_id: dRow.nota_fiscal_id,
    nf_file_name: nf?.file_name ?? null,
    nf_file_path: nf?.file_path ?? null,
    nf_storage_bucket: nf?.storage_bucket ?? null,
    nf_storage_path: nf?.storage_path ?? null,
    prescription_id: dRow.prescription_id,
    prescription_file_path: md?.file_path ?? null,
    prescription_storage_bucket: md?.storage_bucket ?? null,
    prescription_storage_path: md?.storage_path ?? null,
    provider_name: nf?.provider_name ?? null,
    emission_date: nf?.emission_date ?? null,
    total_amount: nf?.total_amount != null ? Number(nf.total_amount) : null,
    patient_name: nf?.patient_name ?? null,
  };
}

async function processOne(row: OutboxRow): Promise<{
  ok: boolean;
  detail: string;
}> {
  const sb = serverClient();
  const docs = await loadClaimDocs(row.claim_id);
  if (!docs) {
    return { ok: false, detail: "claim/docs not found" };
  }

  try {
    const attachments = await fetchAttachments(docs);
    const sent = await sendEmail({
      to: row.to_email,
      subject: row.subject,
      body_html: row.body_html,
      attachments,
    });
    await sb
      .from("health_email_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        gmail_message_id: sent.message_id,
        attachments_meta: attachments.map((a) => ({ filename: a.filename, mime_type: a.mime_type, bytes: a.bytes.length })),
      })
      .eq("id", row.id);
    await sb
      .from("reimbursement_claims")
      .update({
        lifecycle_state: "sent_to_secretary",
        sent_to_secretary_at: new Date().toISOString(),
      })
      .eq("id", row.claim_id)
      .in("lifecycle_state", ["queued_email", "ready_to_send", "draft"]);
    return { ok: true, detail: `sent ${sent.message_id}` };
  } catch (e) {
    const msg = (e as Error).message;
    const nextAttempts = row.attempts + 1;
    const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, row.attempts));
    const finalStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
    await sb
      .from("health_email_outbox")
      .update({
        status: finalStatus,
        attempts: nextAttempts,
        last_error: msg.slice(0, 500),
        scheduled_at: finalStatus === "pending" ? new Date(Date.now() + backoff).toISOString() : new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: false, detail: msg };
  }
}

// Trigger guard — Vercel sets the x-vercel-cron header on scheduled runs.
// In dev we accept ?force=1 (combined with an authenticated admin cookie via
// the existing middleware on /api/cron).
function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  return req.nextUrl.searchParams.get("force") === "1";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = serverClient();
  const { data: rows } = await sb
    .from("health_email_outbox")
    .select("id, claim_id, idempotency_key, to_email, subject, body_html, attempts, status")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(MAX_PER_RUN);

  const queue = (rows ?? []) as OutboxRow[];
  if (queue.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  const detail: { id: string; ok: boolean; msg: string }[] = [];
  for (const r of queue) {
    const out = await processOne(r);
    if (out.ok) sent++; else failed++;
    detail.push({ id: r.id, ok: out.ok, msg: out.detail });
  }

  return NextResponse.json({ processed: queue.length, sent, failed, detail });
}
