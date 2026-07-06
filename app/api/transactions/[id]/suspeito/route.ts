import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnySharedRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ action: z.enum(["add", "remove"]) });

// POST /api/transactions/:id/suspeito
// The one tag mutation a non-admin role (health/household — Ayelet) can make
// herself. Deliberately hardcoded to the "suspeito" tag only — no tag_slug
// param — so this endpoint can never be repurposed to let a non-admin touch
// Kenlo/Laik/Plano, which are Mickael's real reimbursement-claim tracking.
//
// Per-transaction (not per-merchant like the admin bulk-tag routes): Ayelet
// is looking at one line item on her transaction list and flagging that one,
// not every transaction that ever shared its raw description.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireAnySharedRole();
  const { id } = await ctx.params;

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { action } = parsed.data;

  const sb = serverClient();

  // PRIVACY WALL: a transaction hidden from the portal (shared_amount=0)
  // doesn't exist for a non-admin caller, even with a known id. 404, not
  // 403 — the response shouldn't confirm the row exists.
  const { data: tx } = await sb.from("transactions").select("id, shared_amount").eq("id", id).maybeSingle();
  if (!tx || Number(tx.shared_amount) === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: tag } = await sb.from("reimbursement_tags").select("id").eq("slug", "suspeito").maybeSingle();
  if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  if (action === "add") {
    const { error } = await sb
      .from("transaction_reimbursements")
      .upsert({ transaction_id: id, tag_id: tag.id as string, status: "pending" }, { onConflict: "transaction_id,tag_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await sb
      .from("transaction_reimbursements")
      .delete()
      .eq("transaction_id", id)
      .eq("tag_id", tag.id as string);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit("tx.suspeito", { transactionId: id, newValue: { action } });

  return NextResponse.json({ ok: true, suspeito: action === "add" });
}
