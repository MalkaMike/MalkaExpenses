import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { writeAudit } from "@/lib/auth/admin";

export const runtime = "nodejs";

// Legacy endpoint (the UI uses /api/logout). Logout means logout: clear ALL
// role cookies, not just pf_admin — leaving sibling sessions alive on a
// shared computer is a session-hijack hazard.
export async function POST() {
  await writeAudit("admin.logout");
  const jar = await cookies();
  for (const name of ["pf_admin", "pf_health", "pf_secretary", "pf_household"]) {
    jar.delete(name);
  }
  return NextResponse.json({ ok: true });
}
