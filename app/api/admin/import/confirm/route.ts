import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { categorizeAll, type CategorizeInput } from "@/lib/ai/categorize";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({
  importId: z.string().uuid(),
  accountId: z.string().uuid(),
  transactions: z.array(
    z.object({
      externalId: z.string().nullable(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number(),
      description: z.string(),
      type: z.string().nullable().optional()
    })
  )
});

// Confirm a parsed batch:
//   1. Dedup-upsert into transactions (status=pending_review)
//   2. Look up which rows are still uncategorized
//   3. Auto-categorize them via Vertex Gemini Flash (batches of 40)
//   4. Apply category_id + confidence; status=auto_accepted if confidence>=0.9
//   5. Mark cartao_pagamento/transferencias as is_transfer=true so they're
//      excluded from category totals (already excluded from category sums in UI)
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { importId, accountId, transactions } = parsed.data;
  const sb = serverClient();

  const { data: imp } = await sb
    .from("statement_imports")
    .select("file_type")
    .eq("id", importId)
    .single();
  const source = (imp?.file_type as "ofx" | "csv" | "pdf") ?? "ofx";

  // 1) Upsert
  const rows = transactions.map((t) => ({
    account_id: accountId,
    date: t.date,
    description_raw: t.description,
    description_clean: t.description,
    real_amount: t.amount,
    shared_amount: t.amount,
    source,
    source_file_id: importId,
    status: "pending_review" as const,
    created_by: "import" as const,
    external_id: t.externalId
  }));

  const { error: upErr } = await sb
    .from("transactions")
    .upsert(rows, {
      onConflict: "account_id,date,real_amount,description_raw",
      ignoreDuplicates: true
    });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // 2) Re-fetch matching rows so we have their IDs and categorization status
  const dates = Array.from(new Set(rows.map((r) => r.date)));
  const { data: existingRows } = await sb
    .from("transactions")
    .select("id, date, description_raw, real_amount, category_id")
    .eq("account_id", accountId)
    .in("date", dates);

  const matchByKey = new Map<
    string,
    { id: string; date: string; description_raw: string; real_amount: number; category_id: string | null }
  >();
  for (const r of existingRows ?? []) {
    matchByKey.set(`${r.date}|${r.real_amount}|${r.description_raw}`, r);
  }

  const toCategorize: CategorizeInput[] = [];
  for (const r of rows) {
    const m = matchByKey.get(`${r.date}|${Number(r.real_amount)}|${r.description_raw}`);
    if (!m || m.category_id) continue;
    toCategorize.push({
      id: m.id,
      date: r.date,
      description: r.description_raw,
      amount: Number(r.real_amount)
    });
  }

  // 3) Categorize via Vertex
  let categorizedCount = 0;
  let aiErr: string | null = null;

  if (toCategorize.length > 0) {
    try {
      const results = await categorizeAll(toCategorize);

      const { data: cats } = await sb.from("categories").select("id, slug");
      const slugToId = new Map<string, string>();
      for (const c of cats ?? []) slugToId.set(c.slug, c.id);

      for (const r of results) {
        const catId = slugToId.get(r.category_slug) ?? slugToId.get("outros");
        if (!catId) continue;
        const autoAccepted = r.confidence >= 0.9;
        const isTransfer =
          r.category_slug === "cartao_pagamento" || r.category_slug === "transferencias";
        await sb
          .from("transactions")
          .update({
            category_id: catId,
            confidence: r.confidence,
            ai_reasoning: r.reasoning,
            status: autoAccepted ? "auto_accepted" : "pending_review",
            is_transfer: isTransfer
          })
          .eq("id", r.id);
        categorizedCount += 1;
      }
    } catch (e: unknown) {
      aiErr = e instanceof Error ? e.message : "categorization failed";
      console.error("[categorize]", aiErr);
    }
  }

  await sb.from("statement_imports").update({ status: "imported" }).eq("id", importId);

  return NextResponse.json({
    inserted: rows.length,
    categorized: categorizedCount,
    total: rows.length,
    aiError: aiErr
  });
}
