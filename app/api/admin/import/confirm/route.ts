import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

// Confirm a parsed batch — insert into transactions with status='pending_review'.
// Defaults shared_amount = real_amount (full visibility) so the wife sees the
// full real number until Mickael edits in private mode.
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { importId, accountId, transactions } = parsed.data;
  const sb = serverClient();

  const rows = transactions.map((t) => ({
    account_id: accountId,
    date: t.date,
    description_raw: t.description,
    description_clean: t.description,
    real_amount: t.amount,
    shared_amount: t.amount,
    source: "ofx" as const,
    source_file_id: importId,
    status: "pending_review" as const,
    created_by: "import" as const,
    external_id: t.externalId
  }));

  // Use upsert on the dedup unique index — re-uploaded statements are no-ops.
  const { error, count } = await sb
    .from("transactions")
    .upsert(rows, { onConflict: "account_id,date,real_amount,description_raw", ignoreDuplicates: true, count: "exact" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sb.from("statement_imports").update({ status: "imported" }).eq("id", importId);

  return NextResponse.json({ inserted: count ?? rows.length, total: rows.length });
}
