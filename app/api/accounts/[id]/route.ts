import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().min(1).optional(),
  bank: z.string().min(1).optional(),
  type: z.enum(["checking", "savings", "credit_card"]).optional(),
  cc_issuer: z.string().nullable().optional(),
  real_starting_balance: z.number().optional(),
  shared_starting_balance: z.number().optional()
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const sb = serverClient();
  const { error } = await sb.from("accounts").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const sb = serverClient();
  // Soft-delete: archive rather than physical delete
  const { error } = await sb.from("accounts").update({ is_archived: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
