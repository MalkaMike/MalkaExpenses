import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/merchants/clusters";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  // The admin_modifications.id of the merge to reverse
  modification_id: z.string().uuid()
});

// POST /api/admin/merchants/merge/undo
// Reverses a previous merge by re-reading the stored description list from
// admin_modifications.before_value and reassigning those descriptions back to
// the original source_key + source_name.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { modification_id } = parsed.data;

  const sb = serverClient();

  // Fetch the merge record
  const { data: mod } = await sb
    .from("admin_modifications")
    .select("*")
    .eq("id", modification_id)
    .eq("action", "merge")
    .maybeSingle();

  if (!mod) {
    return NextResponse.json({ error: "merge record not found" }, { status: 404 });
  }

  const before = mod.before_value as {
    source_key: string;
    source_name: string;
    descriptions: string[];
  };

  if (!before?.descriptions?.length) {
    return NextResponse.json({
      error: "This merge was created before undo was supported — description list not stored."
    }, { status: 422 });
  }

  const { source_key, source_name, descriptions } = before;

  // Reassign each description back to the original cluster
  const { data: restored, error } = await sb
    .from("merchant_clusters")
    .update({
      canonical_key: source_key,
      canonical_name: source_name
    })
    .in("description_raw", descriptions)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const restoredCount = restored?.length ?? 0;

  // Delete the merge record (it is no longer valid)
  await sb.from("admin_modifications").delete().eq("id", modification_id);

  // Cache invalidation
  invalidateCache();
  const target_key = mod.target_id as string;
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${source_key}`);
  revalidatePath(`/admin/merchants/${target_key}`);

  return NextResponse.json({
    ok: true,
    restored_descriptions: restoredCount,
    source_key,
    source_name
  });
}
