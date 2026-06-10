import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { safeJson } from "@/lib/http";
import { toDb } from "@/lib/money";

export const runtime = "nodejs";

const Body = z.object({
  category_slug: z.string().min(1),
  monthly_limit: z.number().positive()
});

export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== "admin" && role !== "household") {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const sb = serverClient();
  const { data: cat } = await sb
    .from("categories")
    .select("id")
    .eq("slug", parsed.data.category_slug)
    .single();
  if (!cat) return NextResponse.json({ error: "categoria não encontrada" }, { status: 400 });
  const { error } = await sb.from("budgets").insert({
    category_id: cat.id,
    monthly_limit: toDb(parsed.data.monthly_limit)
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
