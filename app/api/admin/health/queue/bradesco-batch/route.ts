import { NextResponse } from "next/server";
import { requireAnyHealthRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import {
  isClaimState,
  checkTransition,
  type ClaimState,
} from "@/lib/health/claim-status";
import { APRIL_START } from "@/lib/health/claim-guidance";

export const runtime = "nodejs";

// POST /api/admin/health/queue/bradesco-batch
//
// Celina's second job in one action: every pre-25/02/2026 invoice goes to the
// previous insurer (Bradesco) as-is. They ask for no report, so there is nothing
// to chase — turning this into one button is the whole point.
//
// Two things this deliberately does NOT do:
//
//   * It does not weaken the lifecycle. not_submitted cannot jump to submitted
//     (claim-status.ts), so an invoice nobody had "taken" moves in two legal
//     hops, with_secretary then submitted. Both are audited. Relaxing the state
//     machine for convenience would blur a money trail.
//   * It does not send an invoice with no PDF. There is nothing to attach, so it
//     is reported back as skipped rather than marked sent — a claim recorded as
//     submitted when nothing left the building is a lie the ledger keeps.
export async function POST() {
  await requireAnyHealthRole();
  const sb = serverClient();

  const { data, error } = await sb
    .from("nota_fiscais")
    .select(
      "id, nf_number, provider_name, emission_date, total_amount, reimbursement_status, storage_path, storage_bucket",
    )
    .eq("is_medical", true)
    .lt("emission_date", APRIL_START)
    .order("emission_date", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const sent: { id: string; nfNumber: string | null }[] = [];
  const skipped: { id: string; nfNumber: string | null; reason: string }[] = [];

  for (const row of data ?? []) {
    const id = row.id as string;
    const nfNumber = (row.nf_number as string) ?? null;
    const from: ClaimState = isClaimState(row.reimbursement_status)
      ? row.reimbursement_status
      : "not_submitted";

    if (from === "submitted" || from === "reimbursed") {
      skipped.push({ id, nfNumber, reason: "já estava enviada" });
      continue;
    }
    if (!(row.storage_bucket && row.storage_path)) {
      skipped.push({ id, nfNumber, reason: "sem PDF da nota para enviar" });
      continue;
    }

    // The legal path to "submitted". A claim sitting on not_submitted has to be
    // taken first; one already with her needs only the second hop.
    const hops: ClaimState[] =
      from === "not_submitted"
        ? ["with_secretary", "submitted"]
        : ["submitted"];

    // Annotated, not inferred: the early-continue above narrows `from` to the
    // three unsent states, so an inferred `state` could not be reassigned to
    // "submitted" at the end of the walk.
    let state: ClaimState = from;
    let failure: string | null = null;

    for (const to of hops) {
      const verdict = checkTransition(state, to, { submittedAt: today });
      if (!verdict.ok) {
        failure = verdict.error;
        break;
      }
      const patch: Record<string, unknown> = { reimbursement_status: to };
      if (to === "submitted") patch.reimbursement_submitted_at = today;

      const { error: updErr } = await sb
        .from("nota_fiscais")
        .update(patch)
        .eq("id", id);
      if (updErr) {
        failure = updErr.message;
        break;
      }
      await writeAudit("health_claim_status", {
        oldValue: { nota_fiscal_id: id, status: state },
        newValue: {
          nota_fiscal_id: id,
          status: to,
          provider: row.provider_name,
          invoice_amount: row.total_amount,
          submitted_at: to === "submitted" ? today : null,
          via: "bradesco_batch",
        },
      });
      state = to;
    }

    if (failure) skipped.push({ id, nfNumber, reason: failure });
    else sent.push({ id, nfNumber });
  }

  return NextResponse.json({
    ok: true,
    sentCount: sent.length,
    skippedCount: skipped.length,
    sent,
    // Never collapse this into a count only: "12 enviadas" while 2 silently sat
    // out is how money stops being chased without anyone noticing.
    skipped,
    submittedAt: today,
  });
}
