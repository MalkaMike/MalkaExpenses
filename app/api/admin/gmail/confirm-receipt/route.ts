import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  receipt_id: z.string().uuid(),
  confirmed: z.boolean().nullable()  // true=accept, false=reject, null=unconfirm
});

// POST /api/admin/gmail/confirm-receipt
// Marks a cached receipt match as confirmed/rejected by the admin.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const sb = serverClient();
  const { error } = await sb
    .from("transaction_receipts")
    .update({ confirmed: parsed.data.confirmed })
    .eq("id", parsed.data.receipt_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
