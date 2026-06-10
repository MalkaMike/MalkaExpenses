import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/merchants/clusters";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  canonical_key: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(120)
});

// POST /api/admin/merchants/rename
// Body: { canonical_key, name }
//
// Updates the DISPLAY NAME for every row of merchant_clusters whose
// canonical_key matches. Does NOT touch canonical_key, so grouping/clustering
// rules are untouched — only the user-facing label changes. Future Pluggy
// syncs whose description_raw already exists in merchant_clusters will pick
// up the new name automatically.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { canonical_key, name } = parsed.data;

  const sb = serverClient();

  // Capture the previous name for the modification log
  const { data: before } = await sb
    .from("merchant_clusters")
    .select("canonical_name")
    .eq("canonical_key", canonical_key)
    .limit(1)
    .maybeSingle();
  const oldName = before?.canonical_name ?? canonical_key;

  const { data: updated, error } = await sb
    .from("merchant_clusters")
    .update({ canonical_name: name })
    .eq("canonical_key", canonical_key)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const updatedCount = updated?.length ?? 0;
  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found" }, { status: 404 });
  }

  // Bust the per-process cluster cache so the next read sees the new name.
  invalidateCache();
  // Bust Next.js route caches so the page re-renders with the new name.
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${canonical_key}`);

  await sb.from("admin_modifications").insert({
    action: "rename",
    scope: "merchant",
    target_id: canonical_key,
    target_name: oldName,
    field: "canonical_name",
    before_value: { name: oldName },
    after_value: { name },
    affected_count: updatedCount
  });

  await writeAudit("merchant.rename", {
    newValue: { canonical_key, name, updated: updatedCount }
  });

  return NextResponse.json({ ok: true, updated: updatedCount, name });
}
