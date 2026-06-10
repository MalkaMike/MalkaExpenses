import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  receipt_ids: z.array(z.string().uuid()).min(1).max(500),
  confirmed: z.boolean().nullable() // true=accept all, false=reject all, null=unconfirm
});

// POST /api/admin/gmail/confirm-receipt/bulk
// Accept/reject many found receipts at once — powers the "Aceitar todas"
// button on the daily nota-fiscal digest.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const sb = serverClient();
  const { data, error } = await sb
    .from("transaction_receipts")
    .update({ confirmed: parsed.data.confirmed })
    .in("id", parsed.data.receipt_ids)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
}
