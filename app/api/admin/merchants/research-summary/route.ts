import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/merchants/research-summary
// Read-only rollup of the merchant_research table: verdict counts + the full
// list of merchants flagged "suspeito" (the whole point of the feature).
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const counts: Record<string, number> = { legitimo: 0, suspeito: 0, desconhecido: 0, pessoa_fisica: 0 };
  const suspicious: { canonical_key: string; summary: string }[] = [];

  let off = 0;
  let total = 0;
  while (true) {
    const { data } = await sb
      .from("merchant_research")
      .select("canonical_key, verdict, summary")
      .range(off, off + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      total++;
      const v = r.verdict as string;
      counts[v] = (counts[v] ?? 0) + 1;
      if (v === "suspeito") suspicious.push({ canonical_key: r.canonical_key as string, summary: r.summary as string });
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  return NextResponse.json({ total, counts, suspicious });
}
