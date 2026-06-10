import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

// POST /api/transactions — admin creates a manual entry for the portal.
//   - real entry:  real_amount = shared_amount = value
//   - "fake" entry (appears to the household but isn't real):
//                  is_fake=true, real_amount=0, shared_amount=value
// Created entries are already "decided" (status=user_edited), so they show in
// the portal immediately (subject to shared_amount<>0) and skip the inbox.
const Body = z.object({
  account_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  shared_amount: z.number(),
  real_amount: z.number().optional(),
  category_slug: z.string().optional(),
  is_fake: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const b = parsed.data;
  const sb = serverClient();

  let categoryId: string | null = null;
  if (b.category_slug) {
    const { data: cat } = await sb
      .from("categories")
      .select("id")
      .eq("slug", b.category_slug)
      .maybeSingle();
    categoryId = (cat?.id as string) ?? null;
  }

  const isFake = b.is_fake ?? false;
  const realAmount = isFake ? 0 : b.real_amount ?? b.shared_amount;

  const { data: created, error } = await sb
    .from("transactions")
    .insert({
      account_id: b.account_id,
      date: b.date,
      description_raw: b.description,
      description_clean: b.description,
      real_amount: realAmount,
      shared_amount: b.shared_amount,
      category_id: categoryId,
      source: "manual",
      status: "user_edited",
      created_by: "user",
      is_fake: isFake
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit("tx.create", { transactionId: created.id as string, newValue: created });
  return NextResponse.json({ ok: true, id: created.id });
}
