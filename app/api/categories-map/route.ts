import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Returns { [slug]: id } so the client can submit category_id for PATCH calls
// without round-tripping a separate lookup. Cached for 5 min.
export async function GET() {
  const sb = serverClient();
  const { data, error } = await sb.from("categories").select("id, slug");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out: Record<string, string> = {};
  for (const c of data ?? []) out[c.slug] = c.id;
  return NextResponse.json(out, {
    headers: { "Cache-Control": "private, max-age=300" }
  });
}
