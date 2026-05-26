import { NextResponse } from "next/server";
import { exitPrivateMode } from "@/lib/auth/mode";

export const runtime = "nodejs";

export async function POST() {
  await exitPrivateMode();
  return NextResponse.json({ ok: true });
}
