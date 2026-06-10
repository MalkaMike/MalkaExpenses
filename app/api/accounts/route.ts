import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole, writeAudit } from "@/lib/auth/admin";
import { safeJson } from "@/lib/http";
import { toDb } from "@/lib/money";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(100),
  bank: z.string().min(1).max(50),
  type: z.enum(["checking", "savings", "credit_card"]),
  real_starting_balance: z.number().finite(),
  shared_starting_balance: z.number().finite(),
  cc_issuer: z.string().nullable().optional()
});

export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const sb = serverClient();
  const { real_starting_balance, shared_starting_balance, ...rest } = parsed.data;
  const { data, error } = await sb.from("accounts").insert({
    ...rest,
    real_starting_balance: toDb(real_starting_balance),
    shared_starting_balance: toDb(shared_starting_balance)
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit("account.create", { newValue: { id: data.id, ...parsed.data } });
  return NextResponse.json(data);
}
