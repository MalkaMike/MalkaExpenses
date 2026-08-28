import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth/admin";
import { buildAuthorizeUrl } from "@/lib/gmail/oauth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

// GET /api/auth/gmail/connect?forRole=<role>
// Admin or health role. Generates an OAuth state token (CSRF protection),
// encodes the target role in it ("nonce.targetRole") so the callback knows
// which credential row to update.
//
// Admin can connect for any role via ?forRole=admin|health|receipts.
// `receipts` is a second READ-ONLY mailbox for the nota fiscal search (personal
// mail). It is deliberately NOT the `admin` row: admin is also the sender in
// lib/gmail/send, so repointing it would change the From on outbound email.
// Health can only connect their own account (no forRole override).
export async function GET(req: NextRequest) {
  const sessionRole = await getRole();
  if (sessionRole !== "admin" && sessionRole !== "health") {
    return NextResponse.redirect(new URL("/", new URL(req.url).origin));
  }

  const reqUrl = new URL(req.url);
  const forRole = reqUrl.searchParams.get("forRole");

  // Admin can target any role; others can only target themselves.
  let targetRole: string;
  if (sessionRole === "admin" && forRole && ["admin", "health", "receipts"].includes(forRole)) {
    targetRole = forRole;
  } else {
    targetRole = sessionRole;
  }

  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}.${targetRole}`; // encode target role for the callback
  const origin = reqUrl.origin;
  const url = buildAuthorizeUrl(origin, state);

  const response = NextResponse.redirect(url);
  response.cookies.set("pf_gmail_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/gmail",
    maxAge: 600 // 10 min
  });
  return response;
}
