import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/merchants/clusters";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  source_canonical_key: z.string().min(1).max(60),
  target_canonical_key: z.string().min(1).max(60)
});

// POST /api/admin/merchants/merge
// Body: { source_canonical_key, target_canonical_key }
//
// Consolidates two merchant clusters: every row in merchant_clusters that
// currently maps to `source_canonical_key` is rewritten to `target_canonical_key`
// (and the target's canonical_name is adopted). Transactions don't need to
// change because they're identified by description_raw — the cluster mapping
// is what determines display name + grouping.
//
// Source cluster effectively ceases to exist (no descriptions map to it).
// Logged to admin_modifications with action='merge' for the History page.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { source_canonical_key, target_canonical_key } = parsed.data;
  if (source_canonical_key === target_canonical_key) {
    return NextResponse.json({ error: "source and target are the same" }, { status: 400 });
  }

  const sb = serverClient();

  // Fetch source + target names BEFORE the merge (for the audit log)
  const { data: src } = await sb
    .from("merchant_clusters")
    .select("canonical_name")
    .eq("canonical_key", source_canonical_key)
    .limit(1)
    .maybeSingle();
  const { data: tgt } = await sb
    .from("merchant_clusters")
    .select("canonical_name")
    .eq("canonical_key", target_canonical_key)
    .limit(1)
    .maybeSingle();

  if (!src) return NextResponse.json({ error: "source cluster not found" }, { status: 404 });
  if (!tgt) return NextResponse.json({ error: "target cluster not found" }, { status: 404 });

  const sourceName = src.canonical_name as string;
  const targetName = tgt.canonical_name as string;

  // Rewrite every source-cluster row to point at the target cluster + name
  const { data: updated, error } = await sb
    .from("merchant_clusters")
    .update({
      canonical_key: target_canonical_key,
      canonical_name: targetName
    })
    .eq("canonical_key", source_canonical_key)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const movedDescs = updated?.length ?? 0;
  if (movedDescs === 0) {
    return NextResponse.json({ error: "no descriptions belonged to source" }, { status: 404 });
  }

  // Count affected transactions for the modification log
  const { data: rawDescs } = await sb
    .from("merchant_clusters")
    .select("description_raw")
    .eq("canonical_key", target_canonical_key);
  const descList = (rawDescs ?? []).map((r) => r.description_raw as string);
  let affectedTxs = 0;
  if (descList.length > 0) {
    for (let i = 0; i < descList.length; i += 200) {
      const slice = descList.slice(i, i + 200);
      const { count } = await sb
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .in("description_raw", slice);
      affectedTxs += count ?? 0;
    }
  }

  // Cache invalidation
  invalidateCache();
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${source_canonical_key}`);
  revalidatePath(`/admin/merchants/${target_canonical_key}`);

  // Modification log (shows in /admin/historico)
  await sb.from("admin_modifications").insert({
    action: "rename", // use "rename" bucket — semantically a name+grouping change
    scope: "merchant",
    target_id: target_canonical_key,
    target_name: sourceName,
    field: "canonical_name",
    before_value: { name: sourceName, descs: movedDescs },
    after_value: { name: targetName, key: target_canonical_key },
    affected_count: affectedTxs,
    notes: `Merge: "${sourceName}" → "${targetName}"`
  });

  await writeAudit("merchant.merge", {
    newValue: {
      source_canonical_key,
      target_canonical_key,
      target_name: targetName,
      descriptions_moved: movedDescs,
      transactions_affected: affectedTxs
    }
  });

  return NextResponse.json({
    ok: true,
    descriptions_moved: movedDescs,
    transactions_affected: affectedTxs,
    target_name: targetName
  });
}
