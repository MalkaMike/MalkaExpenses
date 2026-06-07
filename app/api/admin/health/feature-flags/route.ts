import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

// GET /api/admin/health/feature-flags
// Returns all flags as { key: value }.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();
  const { data } = await sb.from("health_feature_flags").select("key, value");
  const flags: Record<string, unknown> = {};
  for (const r of data ?? []) flags[r.key] = r.value;
  return NextResponse.json({ flags });
}

const Schema = z.object({
  key: z.string().min(1).max(64),
  value: z.unknown(),
});

// POST /api/admin/health/feature-flags
// Body: { key, value }. Upserts the flag.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad params" }, { status: 400 });

  const sb = serverClient();
  const { data, error } = await sb
    .from("health_feature_flags")
    .upsert(
      { key: parsed.data.key, value: parsed.data.value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    )
    .select("key, value")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
