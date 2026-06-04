import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PatchBody = z.object({
  status: z.enum(["pending", "submitted", "reimbursed", "declined"]).optional(),
  reimbursement_amount: z.number().nullable().optional(),
  notes: z.string().max(2000).nullable().optional()
});

// PATCH /api/admin/reimbursements/[id]
// Body: { status?, reimbursement_amount?, notes? }
//
// Updates a single reimbursement claim. Auto-sets submitted_at when status
// goes to 'submitted', reimbursed_at when status goes to 'reimbursed'.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const b = parsed.data;

  const sb = serverClient();
  const patch: Record<string, unknown> = {};
  if (b.status !== undefined) {
    patch.status = b.status;
    if (b.status === "submitted") patch.submitted_at = new Date().toISOString();
    if (b.status === "reimbursed") patch.reimbursed_at = new Date().toISOString();
  }
  if (b.reimbursement_amount !== undefined) patch.reimbursement_amount = b.reimbursement_amount;
  if (b.notes !== undefined) patch.notes = b.notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no changes" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("transaction_reimbursements")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit("reimbursement.update", { newValue: patch });
  return NextResponse.json({ ok: true, reimbursement: data });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const sb = serverClient();
  const { error } = await sb.from("transaction_reimbursements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit("reimbursement.delete", { transactionId: id });
  return NextResponse.json({ ok: true });
}
