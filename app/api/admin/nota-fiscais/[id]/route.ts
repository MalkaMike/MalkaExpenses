import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

// GET /api/admin/nota-fiscais/[id]
// Single NF detail with flight legs (for gmail_email records).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const sb = serverClient();

  const { data, error } = await sb
    .from("nota_fiscais")
    .select("*, nota_fiscal_flights(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(data);
}

const PatchSchema = z.object({
  no_match_reason: z.string().nullable(),
});

// PATCH /api/admin/nota-fiscais/[id]
// Update no_match_reason classification.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;

  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  const sb = serverClient();
  const { data, error } = await sb
    .from("nota_fiscais")
    .update({ no_match_reason: parsed.data.no_match_reason })
    .eq("id", id)
    .select("id, no_match_reason")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
