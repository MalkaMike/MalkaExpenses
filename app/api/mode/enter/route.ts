import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enterPrivateMode, validatePin } from "@/lib/auth/mode";

export const runtime = "nodejs";

const Body = z.object({ pin: z.string().min(4).max(12) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const ok = await validatePin(parsed.data.pin);
  if (!ok) return NextResponse.json({ error: "invalid pin" }, { status: 401 });
  await enterPrivateMode();
  return NextResponse.json({ ok: true });
}
