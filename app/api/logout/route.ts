import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  // Clear all role cookies
  jar.delete("pf_admin");
  jar.delete("pf_health");
  jar.delete("pf_secretary");
  jar.delete("pf_household");
  return NextResponse.json({ ok: true });
}
