import { NextRequest, NextResponse } from "next/server";
import { getRole, writeAudit } from "@/lib/auth/admin";
import { exchangeCodeForTokens, fetchUserInfo, storeCredentials } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

// GET /api/auth/gmail/callback?code=...&state=...
// Validates state (contains "nonce.role"), exchanges code for tokens, stores
// the credential tagged with the role. Admin → redirects to /admin.
// Health → redirects to /admin/merchants (the page they have access to).
export async function GET(req: NextRequest) {
  const role = await getRole();
  if (role !== "admin" && role !== "health") {
    return NextResponse.redirect(new URL("/", new URL(req.url).origin));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Redirect targets per role (admin → /admin, health → /admin/merchants)
  const successPath = role === "health" ? "/admin/merchants?gmail=connected" : "/admin?gmail=connected";
  const errorBase   = role === "health" ? "/admin/merchants?gmail=error"     : "/admin?gmail=error";

  if (error) {
    return NextResponse.redirect(new URL(`${errorBase}&reason=${encodeURIComponent(error)}`, url.origin));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`${errorBase}&reason=missing_params`, url.origin));
  }

  // CSRF: full state ("nonce.role") must match the cookie set by /connect
  const stateCookie = req.cookies.get("pf_gmail_state")?.value;
  if (!stateCookie || stateCookie !== state) {
    return NextResponse.redirect(new URL(`${errorBase}&reason=bad_state`, url.origin));
  }

  // Extract role from state — format is "nonce.role"
  const dotIdx = state.indexOf(".");
  const roleFromState = dotIdx !== -1 ? state.slice(dotIdx + 1) : "admin";

  try {
    const tokens = await exchangeCodeForTokens(code, url.origin);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(new URL(`${errorBase}&reason=no_refresh_token`, url.origin));
    }
    const user = await fetchUserInfo(tokens.access_token);
    await storeCredentials({
      email: user.email,
      sub: user.sub,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresInSec: tokens.expires_in,
      scopes: tokens.scope,
      userRole: roleFromState
    });
    await writeAudit("gmail.connect", { newValue: { email: user.email, role: roleFromState } });

    const response = NextResponse.redirect(new URL(successPath, url.origin));
    response.cookies.delete("pf_gmail_state");
    return response;
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.redirect(
      new URL(`${errorBase}&reason=${encodeURIComponent(msg.slice(0, 100))}`, url.origin)
    );
  }
}
