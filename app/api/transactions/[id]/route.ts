import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { householdSafeTransaction } from "@/lib/security/sanitize";
import { safeJson } from "@/lib/http";
import { toDb, fromDb } from "@/lib/money";

export const runtime = "nodejs";

// PATCH /api/transactions/:id
// Role rules:
//   - household: may edit category_id, description_clean only
//   - admin:     full power — category, description, shared_amount,
//                hide (shared_amount=0), unhide, is_transfer, notes_private,
//                convert to fake (real_amount=0, is_fake=true)
// Returns the updated row.

const Body = z.object({
  category_id: z.string().uuid().nullable().optional(),
  description_clean: z.string().max(500).optional(),
  shared_amount: z.number().finite().optional(),
  real_amount: z.number().finite().optional(),
  is_transfer: z.boolean().optional(),
  is_fake: z.boolean().optional(),
  notes_private: z.string().max(2000).nullable().optional(),
  // semantic flag — sets shared_amount=0 atomically
  hide: z.boolean().optional()
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const role = await getRole();
  if (role !== "household" && role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const b = parsed.data;
  const sb = serverClient();

  // Fetch existing for audit + role-enforcement
  const { data: existing, error: getErr } = await sb
    .from("transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (getErr || !existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // PRIVACY WALL: rows hidden from the portal (shared_amount=0) do not exist
  // for the household role — even with a known/cached UUID. 404, not 403, so
  // the response doesn't confirm the row exists.
  if (role === "household" && Number(existing.shared_amount) === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  // Household may only set these
  if (b.category_id !== undefined) patch.category_id = b.category_id;
  if (b.description_clean !== undefined) patch.description_clean = b.description_clean;

  if (role === "admin") {
    if (b.shared_amount !== undefined) patch.shared_amount = toDb(b.shared_amount);
    if (b.real_amount !== undefined) patch.real_amount = toDb(b.real_amount);
    if (b.is_transfer !== undefined) patch.is_transfer = b.is_transfer;
    if (b.is_fake !== undefined) patch.is_fake = b.is_fake;
    if (b.notes_private !== undefined) patch.notes_private = b.notes_private;
    if (b.hide === true) patch.shared_amount = 0;
    if (b.hide === false && existing.shared_amount === 0) {
      patch.shared_amount = Number(existing.real_amount);
    }
  } else {
    // Household tried to use admin-only fields — silently ignored, but log it
    if (
      b.shared_amount !== undefined ||
      b.real_amount !== undefined ||
      b.is_fake !== undefined ||
      b.hide !== undefined ||
      b.notes_private !== undefined
    ) {
      return NextResponse.json(
        { error: "forbidden: that field requires admin" },
        { status: 403 }
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no changes" }, { status: 400 });
  }

  // Mark as user_edited (preserves auto_accepted history)
  if (existing.status === "pending_review" || existing.status === "auto_accepted") {
    patch.status = "user_edited";
  }

  const { data: updated, error: updErr } = await sb
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await writeAudit("tx.edit", {
    transactionId: id,
    oldValue: existing,
    newValue: updated
  });

  // If shared_amount changed and we're admin, log it to admin_modifications so
  // /admin/historico can show what was overridden vs the wife's view.
  const oldShared = Number(existing.shared_amount);
  const newShared = Number((updated as Record<string, unknown>).shared_amount);
  if (role === "admin" && oldShared !== newShared) {
    const realAmt = Number(existing.real_amount);
    const action =
      newShared === 0
        ? "hide"
        : newShared === realAmt
          ? "show"
          : "adjust";
    const desc = (existing.description_clean as string | null) ?? (existing.description_raw as string);
    await sb.from("admin_modifications").insert({
      action,
      scope: "transaction",
      target_id: id,
      target_name: desc.slice(0, 200),
      field: "shared_amount",
      before_value: { value: fromDb(oldShared) },
      after_value: { value: fromDb(newShared) },
      affected_count: 1,
      impact_brl: fromDb(newShared) - fromDb(oldShared)
    });
  }

  // SECURITY WALL: a household caller (allowed to edit category/description)
  // must never receive real_amount / is_fake / notes_private in the response.
  // .select() returns every column, so sanitize before returning to non-admins.
  const safeTransaction =
    role === "admin"
      ? updated
      : householdSafeTransaction(updated as Record<string, unknown>);

  // Learn merchant rule from category corrections (best-effort).
  // Admin-only: a household correction must never silently retrain the
  // categorization of the WHOLE ledger (including rows she can't see).
  if (role === "admin" && b.category_id && existing.category_id !== b.category_id && existing.description_raw) {
    const pattern = String(existing.description_raw).split(/\s+/).slice(0, 3).join(" ");
    if (pattern.length >= 3) {
      // Check if rule already exists for this pattern
      const { data: existingRule } = await sb
        .from("merchant_rules")
        .select("id")
        .eq("pattern", pattern)
        .maybeSingle();
      if (existingRule) {
        await sb
          .from("merchant_rules")
          .update({ category_id: b.category_id, confidence_default: 0.95 })
          .eq("id", existingRule.id);
      } else {
        await sb.from("merchant_rules").insert({
          pattern,
          pattern_type: "contains",
          category_id: b.category_id,
          confidence_default: 0.95,
          created_from_transaction_id: id
        });
      }
    }
  }

  return NextResponse.json({ ok: true, transaction: safeTransaction });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  const sb = serverClient();
  // maybeSingle distinguishes "row absent" (404) from a DB failure (500) —
  // an operational error must not masquerade as not-found.
  const { data: existing, error: getErr } = await sb.from("transactions").select("*").eq("id", id).maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { error } = await sb.from("transactions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit("tx.delete", { transactionId: id, oldValue: existing });
  return NextResponse.json({ ok: true });
}
