import { NextResponse } from "next/server";
import { logoutHousehold } from "@/lib/auth/household";

export const runtime = "nodejs";

export async function POST() {
  await logoutHousehold();
  return NextResponse.json({ ok: true });
}
