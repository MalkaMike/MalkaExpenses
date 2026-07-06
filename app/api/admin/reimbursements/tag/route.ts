import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  transaction_ids: z.array(z.string().uuid()).min(1).max(500),
  tag_slug: z.enum(["kenlo", "laik", "insurance", "suspeito"]),
  action: z.enum(["add", "remove"])
});

// POST /api/admin/reimbursements/tag
// Body: { transaction_ids[], tag_slug, action: "add" | "remove" }
//
// Adds or removes a reimbursement tag on one or many transactions. Creates
// transaction_reimbursements rows on add (status='pending'); removes on
// "remove". Idempotent (ON CONFLICT DO NOTHING for add).
export async function POST(req: NextRequest) {
  await requireAdmin();
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { transaction_ids, tag_slug, action } = parsed.data;

  const sb = serverClient();
  const { data: tag } = await sb
    .from("reimbursement_tags")
    .select("id")
    .eq("slug", tag_slug)
    .single();
  if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  const HIDE_ON_TAG = ["kenlo", "laik"];
  const SHOW_ON_TAG = ["suspeito"];

  let updated = 0;
  if (action === "add") {
    // Insert one row per (transaction_id, tag_id); skip dupes
    const rows = transaction_ids.map((tid) => ({
      transaction_id: tid,
      tag_id: tag.id as string,
      status: "pending" as const
    }));
    // Supabase doesn't support ON CONFLICT DO NOTHING via .upsert when there's
    // no value to update; we use upsert with ignoreDuplicates so existing
    // rows aren't disturbed.
    const { data, error } = await sb
      .from("transaction_reimbursements")
      .upsert(rows, { onConflict: "transaction_id,tag_id", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated = data?.length ?? 0;

    // Kenlo/Laik tags → always hide from Ayelet (shared_amount = 0)
    if (HIDE_ON_TAG.includes(tag_slug)) {
      await sb
        .from("transactions")
        .update({ shared_amount: 0 })
        .in("id", transaction_ids)
        .neq("shared_amount", 0);
    }

    // Suspeito → always force visible to Ayelet. Each row's target value is
    // its OWN real_amount, so a single literal .update() can't do this —
    // upsert with per-row values instead (matches existing ids, becomes an
    // UPDATE via ON CONFLICT).
    if (SHOW_ON_TAG.includes(tag_slug)) {
      const { data: hiddenRows } = await sb
        .from("transactions")
        .select("id, real_amount")
        .in("id", transaction_ids)
        .eq("shared_amount", 0);
      if (hiddenRows?.length) {
        await sb.from("transactions").upsert(
          hiddenRows.map((r) => ({ id: r.id as string, shared_amount: r.real_amount as number }))
        );
      }
    }
  } else {
    const { data, error } = await sb
      .from("transaction_reimbursements")
      .delete()
      .eq("tag_id", tag.id as string)
      .in("transaction_id", transaction_ids)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated = data?.length ?? 0;
  }

  await writeAudit("reimbursement.tag", {
    newValue: { tag_slug, action, transaction_ids: transaction_ids.length, updated }
  });
  return NextResponse.json({ ok: true, updated });
}
