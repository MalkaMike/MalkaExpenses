import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { SYSTEM_SLUGS } from "@/lib/categories/meta";

const Body = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  icon: z.string().optional().default("circle"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default("#a3a3a3"),
  parent_id: z.string().uuid().nullable().optional()
});

// POST /api/categories — create a new custom category (admin only)
export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { name, slug, icon, color, parent_id } = parsed.data;

  if (SYSTEM_SLUGS.has(slug)) {
    return NextResponse.json(
      { error: "Este slug é reservado para categorias do sistema." },
      { status: 400 }
    );
  }

  const sb = serverClient();

  // Check for slug collision
  const { data: existing } = await sb
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .single();
  if (existing) {
    return NextResponse.json({ error: "Slug já existe." }, { status: 409 });
  }

  const { data, error } = await sb
    .from("categories")
    .insert({ name, slug, icon, color, parent_id: parent_id ?? null })
    .select("id, slug, name, icon, color, parent_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
