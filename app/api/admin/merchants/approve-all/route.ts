import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  canonical_key: z.string().min(1).max(60),
  category_id: z.string().uuid()
});

// POST /api/admin/merchants/approve-all
// Body: { canonical_key, category_id }
//
// One-shot bulk approve for a merchant cluster:
// 1. Sets category_id for all matching transactions
// 2. Sets shared_amount = real_amount (makes them visible to Ayelet)
// 3. Moves status pending_review → user_edited (removes from inbox)
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { canonical_key, category_id } = parsed.data;

  const sb = serverClient();

  // Resolve category slug to derive is_transfer flag
  const { data: cat, error: catErr } = await sb
    .from("categories")
    .select("slug")
    .eq("id", category_id)
    .single();
  if (catErr || !cat) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
  const isTransfer = cat.slug === "transferencias" || cat.slug === "cartao_pagamento";

  // Step 1: set category_id for all cluster transactions
  const { data: catUpdated, error: catRpcErr } = await sb.rpc("bulk_categorize_merchant", {
    p_canonical_key: canonical_key,
    p_category_id: category_id,
    p_is_transfer: isTransfer
  });
  if (catRpcErr) {
    return NextResponse.json(
      { error: `categorize failed: ${catRpcErr.message}` },
      { status: 500 }
    );
  }
  const updatedCount = Number(catUpdated ?? 0);
  if (updatedCount === 0) {
    return NextResponse.json({ error: "cluster not found or empty" }, { status: 404 });
  }

  // Step 2: set shared_amount = real_amount for all cluster transactions.
  // NOTE: Steps 1 and 2 are NOT in a single DB transaction (two separate RPCs).
  // If this step fails, category_id was already set but shared_amount stays 0.
  // Recovery: admin can click "Mostrar" in the secondary row to fix visibility.
  const { error: shareErr } = await sb.rpc("bulk_share_merchant", {
    p_canonical_key: canonical_key,
    p_mode: "show",
    p_value: null
  });
  if (shareErr) {
    return NextResponse.json(
      {
        error: `Categoria aplicada, mas visibilidade falhou: ${shareErr.message}. Clique "Mostrar" na seção de visibilidade para recuperar.`,
        partial: true,
        step_failed: "share"
      },
      { status: 500 }
    );
  }

  // Step 3: move pending_review → user_edited
  // Resolve all description_raw values for this cluster
  const { data: rawDescs, error: descErr } = await sb
    .from("merchant_clusters")
    .select("description_raw")
    .eq("canonical_key", canonical_key);
  if (descErr) {
    // Steps 1-2 already committed — report partial success, not a silent no-op
    return NextResponse.json(
      { ok: false, updated: updatedCount, status_updated: 0, error: `desc lookup failed: ${descErr.message}`, step_failed: "status" },
      { status: 500 }
    );
  }
  const descList = (rawDescs ?? []).map((r) => r.description_raw as string);

  let statusUpdated = 0;
  const statusErrors: string[] = [];
  for (let i = 0; i < descList.length; i += 200) {
    const slice = descList.slice(i, i + 200);
    const { data: updatedRows, error: updErr } = await sb
      .from("transactions")
      .update({ status: "user_edited" })
      .eq("status", "pending_review")
      .in("description_raw", slice)
      .select("id");
    if (updErr) {
      statusErrors.push(updErr.message);
      continue; // rows in this slice stay pending_review — reported below
    }
    statusUpdated += updatedRows?.length ?? 0;
  }

  await writeAudit("merchant.approve_all", {
    newValue: {
      canonical_key,
      category_id,
      updated: updatedCount,
      status_updated: statusUpdated
    }
  });

  return NextResponse.json({
    ok: statusErrors.length === 0,
    updated: updatedCount,
    status_updated: statusUpdated,
    ...(statusErrors.length > 0 ? { partial: true, errors: statusErrors } : {})
  });
}
