import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(100),
  bank: z.string().min(1).max(50),
  type: z.enum(["checking", "savings", "credit_card"]),
  real_starting_balance: z.number(),
  shared_starting_balance: z.number(),
  cc_issuer: z.string().nullable().optional()
});

export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const sb = serverClient();
  const { data, error } = await sb.from("accounts").insert(parsed.data).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
