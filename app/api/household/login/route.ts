import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginHousehold, validateHouseholdPassword } from "@/lib/auth/household";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const ok = await validateHouseholdPassword(parsed.data.password);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600)); // throttle brute force
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }
  await loginHousehold();
  return NextResponse.json({ ok: true });
}
