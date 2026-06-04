import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  transaction_ids: z.array(z.string().uuid()).min(1).max(500),
  tag_slug: z.enum(["kenlo", "laik", "insurance"]),
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
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { transaction_ids, tag_slug, action } = parsed.data;

  const sb = serverClient();
  const { data: tag } = await sb
    .from("reimbursement_tags")
    .select("id")
    .eq("slug", tag_slug)
    .single();
  if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });

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
