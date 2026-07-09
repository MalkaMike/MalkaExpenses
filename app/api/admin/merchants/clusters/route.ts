import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/admin/merchants/clusters
// Returns the full lightweight cluster list ({ key, name }) for the
// rename/merge combobox and the per-row "move description" popover.
//
// Why a dedicated endpoint: this list (~2,400 clusters) used to be embedded in
// every merchant-ficha RSC payload (~120KB) even though the combobox is only
// used occasionally. The client now fetches it lazily on first interaction, so
// the initial ficha payload no longer carries it.
export async function GET() {
  await requireAdmin();

  const sb = serverClient();
  const out: { key: string; name: string }[] = [];
  const seen = new Set<string>();
  let off = 0;
  // Paginate past PostgREST's 1000-row cap so no cluster is dropped.
  while (true) {
    const { data, error } = await sb
      .from("merchant_clusters")
      .select("canonical_key, canonical_name")
      .order("canonical_name", { ascending: true })
      .range(off, off + 999);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const k = r.canonical_key as string;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, name: r.canonical_name as string });
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  return NextResponse.json({ clusters: out });
}
