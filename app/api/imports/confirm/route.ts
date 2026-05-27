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
//   1. Check for duplicates (account_id + date + real_amount + description_raw)
//   2. Insert only new rows — no ON CONFLICT needed (partial unique index is not
//      usable by Postgres for ON CONFLICT; check-then-insert is more reliable)
//   3. Categorize newly inserted rows via Vertex Gemini Flash (batches of 40)
//   4. Apply category_id + confidence; status=auto_accepted if confidence>=0.9
//   5. Mark cartao_pagamento/transferencias as is_transfer=true
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

  // Build the full row objects we want to insert
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
    external_id: t.externalId ?? null
  }));

  // 1) Dedup check — fetch rows for the same account/dates that already exist
  const dates = Array.from(new Set(rows.map((r) => r.date)));

  const { data: alreadyIn } = await sb
    .from("transactions")
    .select("account_id, date, real_amount, description_raw")
    .eq("account_id", accountId)
    .in("date", dates);

  const existingSet = new Set<string>();
  for (const t of alreadyIn ?? []) {
    existingSet.add(
      `${t.account_id}|${t.date}|${Number(t.real_amount)}|${t.description_raw}`
    );
  }

  const newRows = rows.filter(
    (r) =>
      !existingSet.has(
        `${r.account_id}|${r.date}|${Number(r.real_amount)}|${r.description_raw}`
      )
  );
  const duplicateCount = rows.length - newRows.length;

  // 2) Insert only genuinely new rows
  if (newRows.length > 0) {
    const { error: insErr } = await sb.from("transactions").insert(newRows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // 3) Re-fetch inserted rows to get their DB-assigned IDs for categorization
  const { data: fetchedRows } = await sb
    .from("transactions")
    .select("id, date, description_raw, real_amount, category_id")
    .eq("account_id", accountId)
    .in("date", dates);

  // Only categorize rows we just inserted (no category yet)
  const newKeySet = new Set(
    newRows.map((r) => `${r.date}|${Number(r.real_amount)}|${r.description_raw}`)
  );

  const toCategorize: CategorizeInput[] = [];
  for (const r of fetchedRows ?? []) {
    if (r.category_id) continue; // already categorized (e.g. previous import)
    const key = `${r.date}|${Number(r.real_amount)}|${r.description_raw}`;
    if (!newKeySet.has(key)) continue; // not from this batch
    toCategorize.push({
      id: r.id,
      date: r.date,
      description: r.description_raw,
      amount: Number(r.real_amount)
    });
  }

  // 4) Categorize via Vertex
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
    inserted: newRows.length,
    duplicates: duplicateCount,
    categorized: categorizedCount,
    total: rows.length,
    aiError: aiErr
  });
}
