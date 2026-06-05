import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { buildAuthorizeUrl } from "@/lib/gmail/oauth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

// GET /api/auth/gmail/connect
// Admin-only. Generates an OAuth state token (CSRF protection), stashes it
// in a short-lived cookie, and redirects the user to Google's consent screen.
export async function GET(req: NextRequest) {
  await requireAdmin();

  const state = randomBytes(16).toString("hex");
  const origin = new URL(req.url).origin;
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
