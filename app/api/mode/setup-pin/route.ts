import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPinConfigured, setPin } from "@/lib/auth/mode";

export const runtime = "nodejs";

const Body = z.object({ pin: z.string().regex(/^\d{4,12}$/) });

// One-shot PIN setup: only succeeds if no PIN exists yet.
// Once set, changing the PIN requires being in private mode (separate endpoint).
export async function POST(req: NextRequest) {
  if (await isPinConfigured()) {
    return NextResponse.json({ error: "PIN already configured" }, { status: 409 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  await setPin(parsed.data.pin);
  return NextResponse.json({ ok: true });
}
