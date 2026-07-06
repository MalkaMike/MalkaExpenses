import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  receipt_id: z.string().uuid(),
  confirmed: z.boolean().nullable(),          // true=accept, false=reject, null=unconfirm
  reimbursement_tag_slug: z.string().optional() // 'kenlo' | 'laik' | 'insurance' — only on accept
});

// POST /api/admin/gmail/confirm-receipt
// Marks a cached receipt match as confirmed/rejected by the admin.
// When confirmed=true and reimbursement_tag_slug is provided, also creates
// (or upserts) a transaction_reimbursements record so the expense enters the
// reimbursement workflow immediately.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { receipt_id, confirmed, reimbursement_tag_slug } = parsed.data;
  const sb = serverClient();

  // 1) Mark the receipt itself.
  const { error } = await sb
    .from("transaction_receipts")
    .update({ confirmed })
    .eq("id", receipt_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2) If accepting with a reimbursement tag, wire the transaction up.
  if (confirmed === true && reimbursement_tag_slug) {
    // Fetch tag_id and the transaction_id in parallel.
    const [tagRes, receiptRes] = await Promise.all([
      sb.from("reimbursement_tags").select("id").eq("slug", reimbursement_tag_slug).maybeSingle(),
      sb.from("transaction_receipts").select("transaction_id").eq("id", receipt_id).maybeSingle()
    ]);
    const tag = tagRes.data;
    const receipt = receiptRes.data;
    const readErr = tagRes.error ?? receiptRes.error;
    if (readErr || !tag || !receipt) {
      // The receipt was already confirmed above; report that the reimbursement
      // link did NOT happen instead of returning a clean ok:true.
      return NextResponse.json(
        { ok: false, error: `reimbursement link failed: ${readErr?.message ?? "tag or receipt not found"}` },
        { status: 500 }
      );
    }
    // Upsert: if user re-accepts a receipt with a different tag, update the tag.
    const { error: upsertErr } = await sb.from("transaction_reimbursements").upsert(
      {
        transaction_id: receipt.transaction_id,
        tag_id: tag.id,
        status: "pending"
      },
      { onConflict: "transaction_id,tag_id" }
    );
    if (upsertErr) {
      return NextResponse.json(
        { ok: false, error: `reimbursement create failed: ${upsertErr.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
