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
      const { error: hideErr } = await sb
        .from("transactions")
        .update({ shared_amount: 0 })
        .in("id", transaction_ids)
        .neq("shared_amount", 0);
      // Privacy wall write — a silent failure leaves work expenses visible.
      if (hideErr) return NextResponse.json({ error: `hide failed: ${hideErr.message}` }, { status: 500 });
    }

    // Suspeito → always force visible to Ayelet. Each row's target value is
    // its OWN real_amount, so a single literal .update() can't do this — one
    // update per hidden row, in parallel. (The previous upsert-with-partial-
    // rows approach could never work: INSERT ... ON CONFLICT checks NOT NULL
    // columns before conflict resolution, so it always errored — and the
    // error was discarded, leaving hidden rows invisible after tagging.)
    if (SHOW_ON_TAG.includes(tag_slug)) {
      const { data: hiddenRows, error: hiddenErr } = await sb
        .from("transactions")
        .select("id, real_amount")
        .in("id", transaction_ids)
        .eq("shared_amount", 0);
      if (hiddenErr) return NextResponse.json({ error: `hidden lookup failed: ${hiddenErr.message}` }, { status: 500 });
      if (hiddenRows?.length) {
        const results = await Promise.all(
          hiddenRows.map((r) =>
            sb
              .from("transactions")
              .update({ shared_amount: r.real_amount as number })
              .eq("id", r.id as string)
          )
        );
        const failed = results.filter((r) => r.error);
        if (failed.length > 0) {
          return NextResponse.json(
            { error: `unhide failed for ${failed.length} row(s): ${failed[0]!.error!.message}` },
            { status: 500 }
          );
        }
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
