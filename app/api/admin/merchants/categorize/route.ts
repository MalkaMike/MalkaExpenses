import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  canonical_key: z.string().min(1).max(60),
  category_id: z.string().uuid()
});

// POST /api/admin/merchants/categorize
// Body: { canonical_key, category_id }
//
// Updates category_id for ALL transactions whose description maps to that
// canonical merchant cluster, AND mirrors the choice on the cluster row so
// future syncs auto-apply. Runs inside a single Postgres function so cluster
// lookup + tx update + cluster metadata write succeed or fail atomically.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { canonical_key, category_id } = parsed.data;

  const sb = serverClient();

  // Resolve is_transfer flag from the category slug before invoking the RPC.
  const { data: cat, error: catErr } = await sb
    .from("categories")
    .select("slug")
    .eq("id", category_id)
    .single();
  if (catErr || !cat) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
  const isTransfer = cat.slug === "transferencias" || cat.slug === "cartao_pagamento";

  // Atomic bulk update via Postgres function (migration 0007)
  const { data: updated, error: rpcErr } = await sb.rpc("bulk_categorize_merchant", {
    p_canonical_key: canonical_key,
    p_category_id: category_id,
    p_is_transfer: isTransfer
  });

  if (rpcErr) {
    if (rpcErr.message?.includes("category_not_found")) {
      return NextResponse.json({ error: "category not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `bulk update failed: ${rpcErr.message}` },
      { status: 500 }
    );
  }

  const updatedCount = Number(updated ?? 0);
  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found or empty" }, { status: 404 });
  }

  await writeAudit("merchant.bulk_categorize", {
    newValue: { canonical_key, category_id, updated: updatedCount }
  });

  return NextResponse.json({ ok: true, updated: updatedCount });
}
