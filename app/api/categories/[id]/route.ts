import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { SYSTEM_SLUGS } from "@/lib/categories/meta";

// PATCH /api/categories/[id] — rename, recolor, reparent (admin only)
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json();

  const Schema = z.object({
    name:      z.string().min(1).max(60).optional(),
    color:     z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    icon:      z.string().optional(),
    parent_id: z.string().uuid().nullable().optional()
  });

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const sb = serverClient();

  // Prevent editing system categories' slugs (name/color can change)
  const { data: cat } = await sb
    .from("categories")
    .select("slug")
    .eq("id", id)
    .single();

  if (!cat) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (SYSTEM_SLUGS.has(cat.slug) && parsed.data.parent_id !== undefined) {
    return NextResponse.json(
      { error: "Categorias do sistema não podem ser movidas." },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined)      update.name = parsed.data.name;
  if (parsed.data.color !== undefined)     update.color = parsed.data.color;
  if (parsed.data.icon !== undefined)      update.icon = parsed.data.icon;
  if (parsed.data.parent_id !== undefined) update.parent_id = parsed.data.parent_id;

  const { data, error } = await sb
    .from("categories")
    .update(update)
    .eq("id", id)
    .select("id, slug, name, icon, color, parent_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/categories/[id] — soft-delete (admin only)
// Blocked if: system slug OR has transactions referencing it.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const sb = serverClient();

  const { data: cat } = await sb
    .from("categories")
    .select("slug")
    .eq("id", id)
    .single();

  if (!cat) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (SYSTEM_SLUGS.has(cat.slug)) {
    return NextResponse.json(
      { error: "Categorias do sistema não podem ser apagadas." },
      { status: 400 }
    );
  }

  // Check if any transactions reference this category
  const { count } = await sb
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Não é possível apagar: ${count} transação(ões) usam esta categoria. Recategorize-as primeiro.`,
        tx_count: count
      },
      { status: 409 }
    );
  }

  const { error } = await sb.from("categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
