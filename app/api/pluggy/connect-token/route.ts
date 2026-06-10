import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole } from "@/lib/auth/admin";
import { createConnectToken, PluggyConfigError } from "@/lib/pluggy/client";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ itemId: z.string().optional() });

// POST /api/pluggy/connect-token → short-lived token for the Connect widget.
// Pass { itemId } to re-authenticate an existing connection (MFA refresh).
export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await safeJson(req));
  const itemId = parsed.success ? parsed.data.itemId : undefined;

  try {
    const connectToken = await createConnectToken(itemId ? { itemId } : undefined);
    return NextResponse.json({ connectToken });
  } catch (e) {
    if (e instanceof PluggyConfigError) {
      return NextResponse.json({ error: e.message, configured: false }, { status: 503 });
    }
    console.error("[pluggy connect-token]", e);
    return NextResponse.json({ error: "connect token failed" }, { status: 502 });
  }
}
