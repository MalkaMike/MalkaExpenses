import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem, type PluggySyncResult } from "@/lib/pluggy/sync";
import { PluggyConfigError } from "@/lib/pluggy/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ itemId: z.string().optional() });

// POST /api/pluggy/sync → re-pull transactions for one item ({itemId}) or, if
// omitted, every connected item. Use to refresh on demand.
export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const itemId = parsed.success ? parsed.data.itemId : undefined;
  const sb = serverClient();

  // Resolve the set of items to sync.
  let itemIds: string[];
  if (itemId) {
    itemIds = [itemId];
  } else {
    const { data } = await sb
      .from("accounts")
      .select("pluggy_item_id")
      .not("pluggy_item_id", "is", null);
    itemIds = Array.from(
      new Set((data ?? []).map((r) => r.pluggy_item_id as string).filter(Boolean))
    );
  }

  if (itemIds.length === 0) {
    return NextResponse.json({ items: 0, inserted: 0, message: "Nenhuma conexão Pluggy" });
  }

  try {
    const results: PluggySyncResult[] = [];
    for (const id of itemIds) {
      results.push(await syncPluggyItem(sb, id));
    }
    const inserted = results.reduce((s, r) => s + r.inserted, 0);
    const categorized = results.reduce((s, r) => s + r.categorized, 0);
    const reconciled = results.reduce((s, r) => s + r.reconciled, 0);
    return NextResponse.json({ items: itemIds.length, inserted, categorized, reconciled });
  } catch (e) {
    if (e instanceof PluggyConfigError) {
      return NextResponse.json({ error: e.message, configured: false }, { status: 503 });
    }
    console.error("[pluggy sync]", e);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
}
