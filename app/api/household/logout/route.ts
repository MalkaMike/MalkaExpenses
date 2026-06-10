import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

// Legacy endpoint (the UI uses /api/logout). Logout means logout: clear ALL
// role cookies, not just pf_household.
export async function POST() {
  const jar = await cookies();
  for (const name of ["pf_admin", "pf_health", "pf_secretary", "pf_household"]) {
    jar.delete(name);
  }
  return NextResponse.json({ ok: true });
}
