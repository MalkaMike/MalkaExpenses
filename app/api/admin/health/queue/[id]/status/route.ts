import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import {
  isClaimState,
  checkTransition,
  STATE_LABEL,
  type ClaimState
} from "@/lib/health/claim-status";

export const runtime = "nodejs";

// POST /api/admin/health/queue/[id]/status
// Move one medical invoice along the reimbursement lifecycle.
// [id] = nota_fiscais.id. Callable by admin, health, and secretary.
//
// Every write here is a money-trail event, so the transition is validated
// server-side (never trusting the button the client rendered), the previous
// state is re-read inside the request, and the move is written to audit_log.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireAnyHealthRole();
  const { id } = await ctx.params;

  let body: { to?: unknown; amount?: unknown; submittedAt?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  if (!isClaimState(body.to)) {
    return NextResponse.json({ error: "estado desconhecido" }, { status: 400 });
  }
  const to: ClaimState = body.to;

  const amount =
    body.amount == null || body.amount === "" ? null : Number(body.amount);
  if (amount != null && !Number.isFinite(amount)) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  const submittedAt =
    typeof body.submittedAt === "string" && body.submittedAt ? body.submittedAt : null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;

  const sb = serverClient();

  const { data: current, error: readErr } = await sb
    .from("nota_fiscais")
    .select("id, reimbursement_status, is_medical, provider_name, total_amount")
    .eq("id", id)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "nota não encontrada" }, { status: 404 });
  if (!current.is_medical) {
    return NextResponse.json({ error: "esta nota não é médica" }, { status: 400 });
  }

  const from: ClaimState = isClaimState(current.reimbursement_status)
    ? current.reimbursement_status
    : "not_submitted";

  const verdict = checkTransition(from, to, { amount, submittedAt });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 409 });
  }

  const patch: Record<string, unknown> = { reimbursement_status: to };
  if (to === "submitted") {
    patch.reimbursement_submitted_at = submittedAt ?? new Date().toISOString().slice(0, 10);
  }
  if (to === "reimbursed") patch.reimbursement_amount = amount;
  // Leaving a claim means it was not actually reimbursed — clear the figure so
  // a stale amount cannot be counted as money received.
  if (from === "reimbursed" && to !== "reimbursed") patch.reimbursement_amount = null;
  if (notes != null) patch.reimbursement_notes = notes;

  const { error: updErr } = await sb.from("nota_fiscais").update(patch).eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // audit_log has no column for a nota_fiscais id (transaction_id is an FK to
  // transactions), so the invoice is identified inside the jsonb payload.
  // writeAudit never throws and logs its own failures.
  await writeAudit("health_claim_status", {
    oldValue: { nota_fiscal_id: id, status: from },
    newValue: {
      nota_fiscal_id: id,
      status: to,
      provider: current.provider_name,
      invoice_amount: current.total_amount,
      reimbursed_amount: to === "reimbursed" ? amount : null,
      submitted_at: patch.reimbursement_submitted_at ?? null
    }
  });

  return NextResponse.json({ ok: true, from, to, label: STATE_LABEL[to] });
}
