import "server-only";
import { serverClient } from "@/lib/supabase/server";

// ============================================================================
// Claim lifecycle helpers + auto-email outbox queue.
//
// "Ready to send" means the claim has all 3 parts:
//   - payment_status IN ('paid_full', 'paying')  ← from nota_fiscais
//   - the NF itself exists (always true for a claim row)
//   - prescription_id present                      ← from reimbursement_claims
//
// When all three become true, maybeQueueSecretaryEmail() inserts an outbox row
// with a deterministic idempotency_key, which is UNIQUE — so the same claim
// can NEVER produce two emails, no matter how many times we re-trigger.
// ============================================================================

export const CELINA_EMAIL = "financeiro@laik.com.br";

type ReadinessSnapshot = {
  claim_id: string;
  nota_fiscal_id: string;
  has_payment: boolean;
  has_fiscal_doc: boolean;
  has_prescription: boolean;
  ready: boolean;
  lifecycle_state: string;
  provider_name: string | null;
  emission_date: string | null;
  total_amount: number;
  patient_name: string | null;
};

async function isAutoSendEnabled(): Promise<boolean> {
  const sb = serverClient();
  const { data } = await sb
    .from("health_feature_flags")
    .select("value")
    .eq("key", "auto_send_secretary")
    .maybeSingle();
  if (!data) return true; // default ON (per user choice "immediate full auto")
  return data.value === true || data.value === "true";
}

async function loadReadiness(nfId: string): Promise<ReadinessSnapshot | null> {
  const sb = serverClient();
  const { data: nf, error } = await sb
    .from("nota_fiscais")
    .select(
      `id, provider_name, emission_date, total_amount, patient_name,
       payment_status,
       reimbursement_claims(id, prescription_id, lifecycle_state)`
    )
    .eq("id", nfId)
    .maybeSingle();
  if (error || !nf) return null;

  type ClaimRow = { id: string; prescription_id: string | null; lifecycle_state: string };
  const rcRaw = (nf as { reimbursement_claims?: ClaimRow | ClaimRow[] }).reimbursement_claims;
  const claim = Array.isArray(rcRaw) ? rcRaw[0] : rcRaw;
  if (!claim) return null;

  const hasPayment =
    nf.payment_status === "paid_full" || nf.payment_status === "paying";
  const hasPrescription = !!claim.prescription_id;
  const hasFiscalDoc = true;
  const ready = hasPayment && hasPrescription && hasFiscalDoc;

  return {
    claim_id: claim.id,
    nota_fiscal_id: nf.id,
    has_payment: hasPayment,
    has_fiscal_doc: hasFiscalDoc,
    has_prescription: hasPrescription,
    ready,
    lifecycle_state: claim.lifecycle_state ?? "draft",
    provider_name: nf.provider_name,
    emission_date: nf.emission_date,
    total_amount: Number(nf.total_amount ?? 0),
    patient_name: nf.patient_name,
  };
}

/**
 * Idempotently queue (or upsert) the auto-email-to-Celina for a claim.
 *
 * Safe to call from anywhere a 3rd part might land:
 *   - prescription scanned + paired  (app/api/admin/health/scan/route.ts)
 *   - NF imported with is_reimbursable=true (NF ingestion code, future hook)
 *   - payment matched to medical NF (match_payments.py, future hook)
 *
 * Returns the outcome so callers can log if they want, but never throws.
 */
export async function maybeQueueSecretaryEmail(nfId: string): Promise<{
  ok: boolean;
  action: "queued" | "already_queued" | "not_ready" | "paused" | "skipped" | "error";
  detail?: string;
}> {
  try {
    const snap = await loadReadiness(nfId);
    if (!snap) return { ok: false, action: "error", detail: "claim/nf not found" };
    if (!snap.ready) return { ok: true, action: "not_ready" };

    // Skip if the claim is already past the queued/sent stage.
    const blocking = ["queued_email", "sent_to_secretary", "received_by_secretary", "sent_by_secretary", "reimbursed"];
    if (blocking.includes(snap.lifecycle_state)) {
      return { ok: true, action: "already_queued", detail: snap.lifecycle_state };
    }

    const enabled = await isAutoSendEnabled();
    const status = enabled ? "pending" : "paused";

    const sb = serverClient();
    const idempotencyKey = `claim:${snap.claim_id}:send-to-secretary`;

    // Race-safe upsert: the UNIQUE constraint on idempotency_key blocks dupes;
    // we use onConflict so concurrent triggers are a no-op rather than an error.
    const { error: outboxErr } = await sb
      .from("health_email_outbox")
      .upsert(
        {
          claim_id: snap.claim_id,
          idempotency_key: idempotencyKey,
          to_email: CELINA_EMAIL,
          subject: buildSubject(snap),
          body_html: buildBodyHtml(snap),
          status,
          attempts: 0,
          scheduled_at: new Date().toISOString(),
          // attachments_meta is filled by the worker once it fetches signed URLs / file bytes.
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );
    if (outboxErr) {
      return { ok: false, action: "error", detail: outboxErr.message };
    }

    // Flip the claim's lifecycle_state to queued_email (only if it's draft/ready_to_send).
    await sb
      .from("reimbursement_claims")
      .update({
        lifecycle_state: enabled ? "queued_email" : "ready_to_send",
        queued_at: enabled ? new Date().toISOString() : null,
      })
      .eq("id", snap.claim_id)
      .in("lifecycle_state", ["draft", "ready_to_send"]);

    return { ok: true, action: enabled ? "queued" : "paused" };
  } catch (e) {
    return { ok: false, action: "error", detail: (e as Error).message };
  }
}

function fmtBRL(amount: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function buildSubject(snap: ReadinessSnapshot): string {
  const date = snap.emission_date ? snap.emission_date.slice(0, 10) : "—";
  const patient = snap.patient_name ?? "Mickael";
  const provider = (snap.provider_name ?? "—").slice(0, 50);
  return `Reembolso APRIL — ${patient} · ${provider} · ${date}`;
}

function buildBodyHtml(snap: ReadinessSnapshot): string {
  const provider = snap.provider_name ?? "—";
  const date = snap.emission_date ? snap.emission_date.slice(0, 10) : "—";
  const patient = snap.patient_name ?? "Mickael";
  const amount = fmtBRL(snap.total_amount);

  return [
    "<p>Oi Celina,</p>",
    "",
    "<p>Mais uma nota para reembolso no plano APRIL Ma Santé Internationale:</p>",
    "<ul>",
    `  <li><b>Paciente:</b> ${patient}</li>`,
    `  <li><b>Prestador:</b> ${provider}</li>`,
    `  <li><b>Data:</b> ${date}</li>`,
    `  <li><b>Valor:</b> ${amount}</li>`,
    "</ul>",
    "",
    "<p>Estão anexados:</p>",
    "<ol>",
    "  <li>Nota fiscal / recibo</li>",
    "  <li>Pedido médico</li>",
    "  <li>Resumo do reembolso</li>",
    "</ol>",
    "",
    "<p>Quando enviar ao plano, confirme aqui:<br/>",
    `<a href="https://${process.env.NEXT_PUBLIC_BASE_URL ?? "casa.local"}/admin/health?claim=${snap.nota_fiscal_id}">Abrir claim</a></p>`,
    "",
    "<p>Obrigado!<br/>Mickael</p>",
  ].join("\n");
}
