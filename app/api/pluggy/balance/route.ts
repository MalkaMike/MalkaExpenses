import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth/admin";
import { getRealTimeBalance } from "@/lib/pluggy/client";

export const runtime = "nodejs";

// GET /api/pluggy/balance?accountId=<pluggy_account_id>
// Fetches live balance from the bank (Open Finance only — returns 422 for others).
export async function GET(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  try {
    const balance = await getRealTimeBalance(accountId);
    return NextResponse.json(balance);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 429 = rate-limited by bank; 500 = connector error — surface both clearly
    const status = msg.includes("429") ? 429 : msg.includes("404") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
