import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth/admin";
import { listBills } from "@/lib/pluggy/client";

export const runtime = "nodejs";

// GET /api/pluggy/bills?accountId=<pluggy_account_id>
// Returns credit card bills for the account, sorted most-recent first.
export async function GET(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  try {
    const bills = await listBills(accountId);
    return NextResponse.json({ bills });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
