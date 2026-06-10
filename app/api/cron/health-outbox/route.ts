import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { verifyCronSecret } from "@/lib/auth/cron";
import { getRole } from "@/lib/auth/admin";
import { sendEmail, type Attachment } from "@/lib/gmail/send";
import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import { downloadFile, type StorageBucket } from "@/lib/storage/supabase-storage";

export const runtime = "nodejs";
export const maxDuration = 90;

// ============================================================================
// Outbox worker — picks pending health_email_outbox rows and sends them via
// Gmail (gmail.send scope). Idempotent via the UNIQUE idempotency_key.
//
// Schedule: Vercel cron (vercel.json) — authenticated via CRON_SECRET bearer.
// Manual trigger: GET /api/cron/health-outbox?force=1 requires an admin cookie.
//
// File reads: still local /private/* until Phase 4 migrates to Supabase Storage.
// ============================================================================

const PRIVATE_ROOT = process.cwd();
const MAX_PER_RUN = 5;            // pace ourselves; cron runs every 2 min
const MAX_ATTEMPTS = 6;           // ~ 64 min backoff at the longest tail
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
// Lease while a worker holds a row in status "sending" — a crashed worker's
// rows become claimable again after this window.
const SENDING_LEASE_MS = 10 * 60 * 1000;

// Local attachments must live under <cwd>/private — DB-supplied paths are not
// trusted blindly (a "../.." path would otherwise attach arbitrary server
// files to an outgoing email).
function safeLocalRead(relPath: string): Promise<Buffer> {
  const root = resolve(PRIVATE_ROOT, "private");
  const target = resolve(PRIVATE_ROOT, relPath);
  if (target !== root && !target.startsWith(root + sep)) {
    return Promise.reject(new Error(`path escapes private dir: ${relPath}`));
  }
  return readFile(target);
}

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
  lifecycle_state: string | null;
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

// Loads the claim's documents. A document that EXISTS in metadata but fails
// to load is a hard error (`missing`) — sending a reimbursement email without
// its NF/prescription creates a broken claim at the insurer, so the caller
// must fail the row (retry path) instead of sending incomplete.
async function fetchAttachments(docs: ClaimDocs): Promise<{ attachments: Attachment[]; missing: string[] }> {
  const out: Attachment[] = [];
  const missing: string[] = [];

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
      missing.push(`NF (storage): ${docs.nf_storage_path}`);
    }
  } else if (docs.nf_file_path) {
    try {
      const bytes = await safeLocalRead(docs.nf_file_path);
      out.push({
        filename: docs.nf_file_name ?? `nota_fiscal_${docs.nf_id}.pdf`,
        mime_type: "application/pdf",
        bytes,
      });
    } catch (e) {
      console.warn("[outbox] local NF file missing", docs.nf_file_path, (e as Error).message);
      missing.push(`NF (local): ${docs.nf_file_path}`);
    }
  } else {
    // No NF document at all — a reimbursement claim without its invoice is
    // not sendable.
    missing.push("NF: no storage_path or file_path on the nota fiscal");
  }

  // Prescription — required only when the claim has one linked
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
      missing.push(`prescription (storage): ${docs.prescription_storage_path}`);
    }
  } else if (docs.prescription_file_path) {
    try {
      const bytes = await safeLocalRead(docs.prescription_file_path);
      out.push({ filename: `pedido_medico.${prescExt}`, mime_type: prescMime, bytes });
    } catch (e) {
      console.warn("[outbox] local prescription file missing", docs.prescription_file_path, (e as Error).message);
      missing.push(`prescription (local): ${docs.prescription_file_path}`);
    }
  } else if (docs.prescription_id) {
    missing.push("prescription: linked but has no storage_path or file_path");
  }

  return { attachments: out, missing };
}

async function loadClaimDocs(claimId: string): Promise<ClaimDocs | null> {
  const sb = serverClient();
  const { data, error } = await sb
    .from("reimbursement_claims")
    .select(
      `id, nota_fiscal_id, prescription_id, lifecycle_state,
       nota_fiscais(provider_name, emission_date, total_amount, patient_name, file_name, file_path, storage_bucket, storage_path),
       medical_documents(file_path, storage_bucket, storage_path)`
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error || !data) return null;
  type NfRel = { provider_name: string | null; emission_date: string | null; total_amount: number | string | null; patient_name: string | null; file_name: string | null; file_path: string | null; storage_bucket: string | null; storage_path: string | null };
  type MdRel = { file_path: string | null; storage_bucket: string | null; storage_path: string | null };
  const dRow = data as { id: string; nota_fiscal_id: string; prescription_id: string | null; lifecycle_state: string | null; nota_fiscais: NfRel | NfRel[] | null; medical_documents: MdRel | MdRel[] | null };
  const nf = Array.isArray(dRow.nota_fiscais) ? dRow.nota_fiscais[0] : dRow.nota_fiscais;
  const md = Array.isArray(dRow.medical_documents) ? dRow.medical_documents[0] : dRow.medical_documents;
  return {
    claim_id: dRow.id,
    lifecycle_state: dRow.lifecycle_state,
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

// Sendable claim states — anything else means the claim moved on (cancelled,
// already sent, etc.) after this email was queued; sending now would be stale.
const SENDABLE_STATES = ["queued_email", "ready_to_send", "draft"];

// Single failure path: increments attempts with exponential backoff, gives up
// after MAX_ATTEMPTS. Every non-success outcome goes through here so nothing
// can retry forever without counting.
async function failRow(row: OutboxRow, msg: string): Promise<{ ok: false; detail: string }> {
  const sb = serverClient();
  const nextAttempts = row.attempts + 1;
  const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, row.attempts));
  const finalStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
  const { error } = await sb
    .from("health_email_outbox")
    .update({
      status: finalStatus,
      attempts: nextAttempts,
      last_error: msg.slice(0, 500),
      scheduled_at: finalStatus === "pending" ? new Date(Date.now() + backoff).toISOString() : new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error("[outbox] CRITICAL: failed to persist failure state for", row.id, error.message);
  }
  return { ok: false, detail: msg };
}

async function processOne(row: OutboxRow): Promise<{
  ok: boolean;
  detail: string;
}> {
  const sb = serverClient();
  const docs = await loadClaimDocs(row.claim_id);
  if (!docs) {
    return failRow(row, "claim/docs not found");
  }

  // Claim moved on since this email was queued → terminal, no retries.
  if (docs.lifecycle_state && !SENDABLE_STATES.includes(docs.lifecycle_state)) {
    const { error } = await sb
      .from("health_email_outbox")
      .update({
        status: "failed",
        last_error: `claim no longer sendable (lifecycle_state=${docs.lifecycle_state})`,
      })
      .eq("id", row.id);
    if (error) console.error("[outbox] CRITICAL: failed to mark stale row", row.id, error.message);
    return { ok: false, detail: `stale: claim in ${docs.lifecycle_state}` };
  }

  try {
    const { attachments, missing } = await fetchAttachments(docs);
    if (missing.length > 0) {
      // Never send a reimbursement email without its documents.
      return failRow(row, `missing documents: ${missing.join("; ")}`);
    }
    const sent = await sendEmail({
      to: row.to_email,
      subject: row.subject,
      body_html: row.body_html,
      attachments,
    });
    // Post-send persistence failures are CRITICAL: the email is out, and a
    // row stuck in "sending"/"pending" would be re-sent on a later run.
    const { error: outboxErr } = await sb
      .from("health_email_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        gmail_message_id: sent.message_id,
        attachments_meta: attachments.map((a) => ({ filename: a.filename, mime_type: a.mime_type, bytes: a.bytes.length })),
      })
      .eq("id", row.id);
    if (outboxErr) {
      console.error(
        "[outbox] CRITICAL: email sent but outbox row not marked sent — duplicate-send risk.",
        { row: row.id, gmail_message_id: sent.message_id, error: outboxErr.message }
      );
    }
    const { error: claimErr } = await sb
      .from("reimbursement_claims")
      .update({
        lifecycle_state: "sent_to_secretary",
        sent_to_secretary_at: new Date().toISOString(),
      })
      .eq("id", row.claim_id)
      .in("lifecycle_state", SENDABLE_STATES);
    if (claimErr) {
      console.error("[outbox] claim lifecycle update failed", { claim: row.claim_id, error: claimErr.message });
    }
    return { ok: true, detail: `sent ${sent.message_id}` };
  } catch (e) {
    return failRow(row, (e as Error).message);
  }
}

// Trigger guard. Two legitimate callers:
//   1. Vercel cron — sends `Authorization: Bearer <CRON_SECRET>` (constant-time check).
//   2. Manual trigger — an authenticated ADMIN session with ?force=1.
// The old x-vercel-cron header check was removed: that header is client-supplied
// and spoofable, and ?force=1 had no cookie check (middleware lets /api/cron/*
// through unauthenticated), leaving this worker open to anyone on the internet.
async function isAuthorized(req: NextRequest): Promise<boolean> {
  if (verifyCronSecret(req)) return true;
  if (req.nextUrl.searchParams.get("force") === "1") {
    return (await getRole()) === "admin";
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = serverClient();
  const nowIso = new Date().toISOString();
  // Pick pending rows, plus "sending" rows whose lease expired (a worker
  // crashed mid-send and never resolved them).
  const { data: rows, error: pickErr } = await sb
    .from("health_email_outbox")
    .select("id, claim_id, idempotency_key, to_email, subject, body_html, attempts, status")
    .in("status", ["pending", "sending"])
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (pickErr) {
    return NextResponse.json({ error: pickErr.message }, { status: 500 });
  }

  const queue = (rows ?? []) as OutboxRow[];
  if (queue.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const detail: { id: string; ok: boolean; msg: string }[] = [];
  for (const r of queue) {
    // Atomic claim: flip to "sending" with a lease. The scheduled_at <= now
    // guard means a concurrent worker that already claimed (and pushed the
    // lease into the future) makes this update match 0 rows → we skip.
    const { data: claimed, error: claimErr } = await sb
      .from("health_email_outbox")
      .update({ status: "sending", scheduled_at: new Date(Date.now() + SENDING_LEASE_MS).toISOString() })
      .eq("id", r.id)
      .in("status", ["pending", "sending"])
      .lte("scheduled_at", nowIso)
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) {
      skipped++;
      detail.push({ id: r.id, ok: false, msg: claimErr ? `claim failed: ${claimErr.message}` : "claimed by another worker" });
      continue;
    }
    const out = await processOne(r);
    if (out.ok) sent++; else failed++;
    detail.push({ id: r.id, ok: out.ok, msg: out.detail });
  }

  return NextResponse.json({ processed: queue.length, sent, failed, skipped, detail });
}
