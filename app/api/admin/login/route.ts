import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginAdmin, validatePassword } from "@/lib/auth/admin";

export const runtime = "nodejs";

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const ok = await validatePassword(parsed.data.password);
  if (!ok) {
    // brief artificial delay to slow brute force
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }
  await loginAdmin();
  return NextResponse.json({ ok: true });
}
