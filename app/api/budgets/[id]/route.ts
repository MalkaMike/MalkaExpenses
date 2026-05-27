import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const role = await getRole();
  if (role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  const sb = serverClient();
  const { error } = await sb.from("budgets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
