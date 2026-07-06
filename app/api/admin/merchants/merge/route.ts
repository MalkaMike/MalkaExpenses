import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/merchants/clusters";
import { ensureClusterRowsExist } from "@/lib/merchants/ensure-cluster";
import { safeJson } from "@/lib/http";

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

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { source_canonical_key, target_canonical_key } = parsed.data;
  if (source_canonical_key === target_canonical_key) {
    return NextResponse.json({ error: "source and target are the same" }, { status: 400 });
  }

  const sb = serverClient();

  // A merchant never explicitly touched (renamed/tagged/reviewed) may have NO
  // merchant_clusters row at all — clusterFor() computes its key on the fly
  // from description_raw without ever persisting it. Without this, the target
  // lookup below 404s with "target cluster not found" for any such merchant.
  // Independent of each other → parallel.
  await Promise.all([
    ensureClusterRowsExist(source_canonical_key, sb),
    ensureClusterRowsExist(target_canonical_key, sb)
  ]);

  // Fetch source + target names BEFORE the merge (for the audit log) and the
  // description list that WILL be moved (needed for undo) — all independent.
  const [srcRes, tgtRes, srcDescRes] = await Promise.all([
    sb
      .from("merchant_clusters")
      .select("canonical_name")
      .eq("canonical_key", source_canonical_key)
      .limit(1)
      .maybeSingle(),
    sb
      .from("merchant_clusters")
      .select("canonical_name")
      .eq("canonical_key", target_canonical_key)
      .limit(1)
      .maybeSingle(),
    sb
      .from("merchant_clusters")
      .select("description_raw")
      .eq("canonical_key", source_canonical_key)
  ]);

  const src = srcRes.data;
  const tgt = tgtRes.data;
  if (!src) return NextResponse.json({ error: "source cluster not found" }, { status: 404 });
  if (!tgt) return NextResponse.json({ error: "target cluster not found" }, { status: 404 });

  const sourceName = src.canonical_name as string;
  const targetName = tgt.canonical_name as string;

  // If the undo list can't be read, ABORT before mutating — merging with an
  // empty before_value would make the merge silently irreversible.
  if (srcDescRes.error) {
    return NextResponse.json({ error: `undo-list read failed: ${srcDescRes.error.message}` }, { status: 500 });
  }
  const srcDescList = (srcDescRes.data ?? []).map((r) => r.description_raw as string);

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
    const slices: string[][] = [];
    for (let i = 0; i < descList.length; i += 200) slices.push(descList.slice(i, i + 200));
    const counts = await Promise.all(
      slices.map((slice) =>
        sb
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .in("description_raw", slice)
      )
    );
    for (const c of counts) affectedTxs += c.count ?? 0;
  }

  // Cache invalidation
  invalidateCache();
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${source_canonical_key}`);
  revalidatePath(`/admin/merchants/${target_canonical_key}`);

  // Modification log — stores the full description list so the merge can be
  // undone by reassigning those descriptions back to the original key+name.
  const { error: histErr } = await sb.from("admin_modifications").insert({
    action: "merge",
    scope: "merchant",
    target_id: target_canonical_key,
    target_name: targetName,
    field: "canonical_key",
    before_value: {
      source_key:  source_canonical_key,
      source_name: sourceName,
      // Full list of description_raw values moved — required for undo
      descriptions: srcDescList
    },
    after_value: { key: target_canonical_key, name: targetName },
    affected_count: affectedTxs,
    notes: `Merge: "${sourceName}" → "${targetName}" (${movedDescs} descrições)`
  });
  // The merge already committed; a lost history row means it can't be undone
  // from /admin/historico — surface it instead of pretending it's recorded.
  if (histErr) console.error("[merge] admin_modifications insert failed:", histErr.message);

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
    target_name: targetName,
    ...(histErr ? { history_warning: `merge done but NOT undoable — history write failed: ${histErr.message}` } : {})
  });
}
