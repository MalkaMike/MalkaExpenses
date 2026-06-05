import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { exchangeCodeForTokens, fetchUserInfo, storeCredentials } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

// GET /api/auth/gmail/callback?code=...&state=...
// Receives the OAuth code from Google, validates state, exchanges for
// tokens, and stores the refresh_token in gmail_credentials. Redirects
// back to /admin?gmail=connected on success.
export async function GET(req: NextRequest) {
  await requireAdmin();

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/admin?gmail=error&reason=${encodeURIComponent(error)}`, url.origin));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`/admin?gmail=error&reason=missing_params`, url.origin));
  }

  // CSRF check
  const stateCookie = req.cookies.get("pf_gmail_state")?.value;
  if (!stateCookie || stateCookie !== state) {
    return NextResponse.redirect(new URL(`/admin?gmail=error&reason=bad_state`, url.origin));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, url.origin);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL(`/admin?gmail=error&reason=no_refresh_token`, url.origin)
      );
    }
    const user = await fetchUserInfo(tokens.access_token);
    await storeCredentials({
      email: user.email,
      sub: user.sub,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresInSec: tokens.expires_in,
      scopes: tokens.scope
    });
    await writeAudit("gmail.connect", { newValue: { email: user.email } });

    const response = NextResponse.redirect(new URL(`/admin?gmail=connected`, url.origin));
    response.cookies.delete("pf_gmail_state");
    return response;
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.redirect(
      new URL(`/admin?gmail=error&reason=${encodeURIComponent(msg.slice(0, 100))}`, url.origin)
    );
  }
}
