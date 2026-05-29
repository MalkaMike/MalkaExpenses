import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { syncPluggyItem } from "@/lib/pluggy/sync";
import { PluggyConfigError } from "@/lib/pluggy/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ itemId: z.string().min(1) });

// POST /api/pluggy/items → the Connect widget succeeded with an itemId.
// Links the item's accounts and runs the initial transaction sync.
export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const sb = serverClient();
  try {
    const result = await syncPluggyItem(sb, parsed.data.itemId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PluggyConfigError) {
      return NextResponse.json({ error: e.message, configured: false }, { status: 503 });
    }
    console.error("[pluggy items]", e);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
}
