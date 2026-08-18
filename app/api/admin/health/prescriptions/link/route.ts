import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { recomputeOne } from "@/lib/eligibility/recompute";
import { maybeQueueSecretaryEmail } from "@/lib/health/lifecycle";
import { z } from "zod";
import { log } from "@/lib/log";

export const runtime = "nodejs";

const Schema = z.object({
  medical_document_id: z.string().uuid(),
  nota_fiscal_id: z.string().uuid(),
});

// POST /api/admin/health/prescriptions/link
// Links a previously-saved medical_document (prescription) to a nota fiscal.
// Idempotent: calling again for the same NF just updates the prescription_id.
// Fires eligibility recompute + secretary email queue (both idempotent).
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad params" }, { status: 400 });

  const { medical_document_id, nota_fiscal_id } = parsed.data;
  const sb = serverClient();

  // Verify the prescription doc exists
  const { data: doc } = await sb
    .from("medical_documents")
    .select("id")
    .eq("id", medical_document_id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "prescription not found" }, { status: 404 });

  // Verify the NF is reimbursable
  const { data: nf } = await sb
    .from("nota_fiscais")
    .select("id, is_reimbursable")
    .eq("id", nota_fiscal_id)
    .maybeSingle();
  if (!nf) return NextResponse.json({ error: "nota fiscal not found" }, { status: 404 });
  if (!nf.is_reimbursable) return NextResponse.json({ error: "nota fiscal is not reimbursable" }, { status: 400 });

  // Upsert the claim row
  const { data: existing } = await sb
    .from("reimbursement_claims")
    .select("id")
    .eq("nota_fiscal_id", nota_fiscal_id)
    .maybeSingle();

  let claimId: string;
  if (existing) {
    const { error: updErr } = await sb
      .from("reimbursement_claims")
      .update({ prescription_id: medical_document_id })
      .eq("id", existing.id);
    if (updErr) return NextResponse.json({ error: `claim link failed: ${updErr.message}` }, { status: 500 });
    claimId = existing.id;
  } else {
    const { data: inserted, error } = await sb
      .from("reimbursement_claims")
      .insert({ nota_fiscal_id, prescription_id: medical_document_id, determined_by: "manual" })
      .select("id")
      .single();
    if (error || !inserted) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
    claimId = inserted.id;
  }

  // Downstream eligibility recompute + email queue via after() — a bare
  // `void promise` can be frozen with the lambda before it runs on Vercel.
  after(async () => {
    await recomputeOne(nota_fiscal_id).catch((e) =>
      console.warn("[prescriptions/link→recompute]", nota_fiscal_id, (e as Error).message)
    );
    await maybeQueueSecretaryEmail(nota_fiscal_id).then((r) => {
      if (!r.ok) console.warn("[prescriptions/link→queue-email]", nota_fiscal_id, r.detail);
      else if (r.action === "queued") log.info("prescription_email_queued", { notaFiscalId: nota_fiscal_id });
    });
  });

  return NextResponse.json({ ok: true, claim_id: claimId });
}
