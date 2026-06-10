import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/merchants/clusters";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

// Slugify a name into a canonical_key — same algorithm as clusterLookup fallback
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "unknown"
  );
}

const Body = z.discriminatedUnion("mode", [
  // Move this description into an EXISTING cluster
  z.object({
    mode: z.literal("move-to-existing"),
    description_raw: z.string().min(1).max(500),
    target_canonical_key: z.string().min(1).max(60)
  }),
  // Move this description into a NEW cluster (name-only)
  z.object({
    mode: z.literal("move-to-new"),
    description_raw: z.string().min(1).max(500),
    new_canonical_name: z.string().min(1).max(120)
  })
]);

// POST /api/admin/merchants/move-description
//
// Reassigns a single description_raw (i.e. one specific bank description string)
// to a different merchant cluster — without touching the rest of the rows in
// the source cluster.
//
// Use case: Claudia detail shows a row that's actually a Shirley payment
// mis-clustered. Click ↗ on that row → search "Shirley" → click. All
// transactions sharing the same description_raw are moved.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }

  const sb = serverClient();
  const description_raw = parsed.data.description_raw;

  // Fetch the current cluster mapping for this description (if any)
  const { data: existing } = await sb
    .from("merchant_clusters")
    .select("id, canonical_key, canonical_name")
    .eq("description_raw", description_raw)
    .maybeSingle();

  let target_canonical_key: string;
  let target_canonical_name: string;

  if (parsed.data.mode === "move-to-existing") {
    target_canonical_key = parsed.data.target_canonical_key;
    // Get target name from any existing row with the same key
    const { data: targetRow } = await sb
      .from("merchant_clusters")
      .select("canonical_name")
      .eq("canonical_key", target_canonical_key)
      .limit(1)
      .maybeSingle();
    if (!targetRow) {
      return NextResponse.json({ error: "target cluster not found" }, { status: 404 });
    }
    target_canonical_name = targetRow.canonical_name as string;
  } else {
    // New cluster — slug from name
    target_canonical_name = parsed.data.new_canonical_name.trim();
    target_canonical_key = slugify(target_canonical_name);
  }

  // Upsert the description → new cluster mapping
  const { error: upErr } = await sb.from("merchant_clusters").upsert(
    {
      description_raw,
      canonical_key: target_canonical_key,
      canonical_name: target_canonical_name
    },
    { onConflict: "description_raw" }
  );
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Count affected transactions for the modification log
  const { count: affected } = await sb
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("description_raw", description_raw);

  // Cache invalidation
  invalidateCache();
  if (existing) revalidatePath(`/admin/merchants/${existing.canonical_key}`);
  revalidatePath(`/admin/merchants/${target_canonical_key}`);
  revalidatePath("/admin/merchants");

  // Audit + modification log (shows in /admin/historico)
  await sb.from("admin_modifications").insert({
    action: "rename",
    scope: "merchant",
    target_id: target_canonical_key,
    target_name: target_canonical_name,
    field: "canonical_key",
    before_value: existing
      ? {
          source_key: existing.canonical_key,
          source_name: existing.canonical_name,
          description_raw
        }
      : { description_raw, source_key: null, source_name: null },
    after_value: { key: target_canonical_key, name: target_canonical_name, description_raw },
    affected_count: affected ?? 0,
    notes: `Mover descrição "${description_raw}" → "${target_canonical_name}"`
  });

  await writeAudit("merchant.move_description", {
    newValue: {
      description_raw,
      source_key: existing?.canonical_key ?? null,
      target_canonical_key,
      target_canonical_name,
      transactions_affected: affected ?? 0
    }
  });

  return NextResponse.json({
    ok: true,
    target_canonical_key,
    target_canonical_name,
    transactions_affected: affected ?? 0
  });
}
