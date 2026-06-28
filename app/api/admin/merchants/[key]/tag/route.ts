import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";
import { rawDescriptionsForKeyDirect, preloadClusters } from "@/lib/merchants/clusters";
import { ensureClusterRowsExist } from "@/lib/merchants/ensure-cluster";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  tag_slug: z.enum(["kenlo", "laik", "insurance"]),
  action: z.enum(["add", "remove"])
});

// POST /api/admin/merchants/[key]/tag
// Body: { tag_slug, action: "add" | "remove" }
// Bulk-applies or removes a reimbursement tag on all transactions of the merchant cluster.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAdmin();
  const { key: rawKey } = await params;
  const merchantKey = decodeURIComponent(rawKey);

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { tag_slug, action } = parsed.data;

  await preloadClusters();
  const sb = serverClient();
  // Ensure cluster rows exist for slug-fallback merchants before looking up descriptions
  await ensureClusterRowsExist(merchantKey, sb);
  const rawDescs = await rawDescriptionsForKeyDirect(merchantKey);
  if (!rawDescs.length) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  // Load all matching transaction IDs (paginated, chunked by description)
  const txIds: string[] = [];
  const DESC_CHUNK = 200;
  for (let i = 0; i < rawDescs.length; i += DESC_CHUNK) {
    const slice = rawDescs.slice(i, i + DESC_CHUNK);
    let off = 0;
    while (true) {
      const { data, error } = await sb
        .from("transactions")
        .select("id")
        .in("description_raw", slice)
        .eq("is_fake", false)
        .range(off, off + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data?.length) break;
      txIds.push(...(data as { id: string }[]).map((t) => t.id));
      if (data.length < 1000) break;
      off += 1000;
    }
  }

  if (!txIds.length) return NextResponse.json({ ok: true, updated: 0 });

  const { data: tag } = await sb
    .from("reimbursement_tags")
    .select("id")
    .eq("slug", tag_slug)
    .single();
  if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  // Apply in chunks of 500 (Supabase in() limit)
  let updated = 0;
  const CHUNK = 500;
  for (let i = 0; i < txIds.length; i += CHUNK) {
    const chunk = txIds.slice(i, i + CHUNK);
    if (action === "add") {
      const rows = chunk.map((tid) => ({
        transaction_id: tid,
        tag_id: tag.id as string,
        status: "pending" as const
      }));
      const { data, error } = await sb
        .from("transaction_reimbursements")
        .upsert(rows, { onConflict: "transaction_id,tag_id", ignoreDuplicates: true })
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      updated += data?.length ?? 0;
    } else {
      const { data, error } = await sb
        .from("transaction_reimbursements")
        .delete()
        .eq("tag_id", tag.id as string)
        .in("transaction_id", chunk)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      updated += data?.length ?? 0;
    }
  }

  // Applying a tag is a review decision — mark merchant as reviewed and enforce
  // the visibility rule so the row moves to the correct tab automatically.
  if (action === "add") {
    // Two-pass UPDATE for robustness:
    // Pass 1: by canonical_key (standard case — row already exists with the right key).
    // Pass 2: by description_raw (handles the case where ensureClusterRowsExist's
    //   ignoreDuplicates upsert was skipped because a row existed with a different
    //   canonical_key — without this pass, the UPDATE in pass 1 matches 0 rows and
    //   is_reviewed is silently never set).
    const { error: revErr } = await sb
      .from("merchant_clusters")
      .update({ is_reviewed: true })
      .eq("canonical_key", merchantKey);
    if (revErr) console.error("[tag] is_reviewed by key failed:", revErr.message);

    if (rawDescs.length > 0) {
      const { error: revErr2 } = await sb
        .from("merchant_clusters")
        .update({ is_reviewed: true, canonical_key: merchantKey })
        .in("description_raw", rawDescs);
      if (revErr2) console.error("[tag] is_reviewed by desc failed:", revErr2.message);
    }

    const hideOnTag = ["kenlo", "laik"];
    const showOnTag = ["insurance"];
    if (hideOnTag.includes(tag_slug)) {
      const { error: hideErr } = await sb.rpc("bulk_share_merchant", { p_canonical_key: merchantKey, p_mode: "hide", p_value: null });
      if (hideErr) console.error("[tag] bulk_share_merchant hide failed:", hideErr.message);
    } else if (showOnTag.includes(tag_slug)) {
      const { error: showErr } = await sb.rpc("bulk_share_merchant", { p_canonical_key: merchantKey, p_mode: "show", p_value: null });
      if (showErr) console.error("[tag] bulk_share_merchant show failed:", showErr.message);
    }
  }

  await writeAudit("reimbursement.tag", {
    newValue: { merchant_key: merchantKey, tag_slug, action, updated }
  });
  return NextResponse.json({ ok: true, updated });
}
