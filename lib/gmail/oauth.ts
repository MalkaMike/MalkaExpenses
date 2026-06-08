import "server-only";
import { env } from "@/lib/env";
import { serverClient } from "@/lib/supabase/server";

// ============================================================================
// Gmail OAuth 2.0 — bare-metal fetch-based client (no googleapis dep)
//
// Flow:
//   1. /api/auth/gmail/connect → redirect to Google authorize URL
//   2. Google redirects back to /api/auth/gmail/callback with ?code=...
//   3. We exchange code for refresh_token + access_token, store in DB
//      tagged with user_role (admin | health) — one row per role
//   4. Whenever we need to call Gmail or Sheets API, getValidAccessToken(role)
//      refreshes the access_token if expired (using the long-lived refresh_token)
//
// Scopes:
//   - gmail.readonly   — read messages, attachments, labels
//   - gmail.send       — send the auto-email of claims to Celina (secretária)
//   - userinfo.email   — get the connected Gmail address
//   - spreadsheets     — create Google Sheets (merchant CSV export)
// ============================================================================

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/spreadsheets"   // create Sheets on user's Drive
].join(" ");

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Compute the OAuth redirect URI based on the current request origin. */
export function getRedirectUri(origin: string): string {
  return `${origin}/api/auth/gmail/callback`;
}

/** Build the URL to send the admin to for Google consent. */
export function buildAuthorizeUrl(origin: string, state: string): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: getRedirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",            // need a refresh_token
    prompt: "consent",                 // force refresh_token issuance each time
    include_granted_scopes: "true",
    state
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;          // seconds
  refresh_token?: string;      // only on first consent (or with prompt=consent)
  scope: string;
  token_type: "Bearer";
};

/** Exchange the OAuth code for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  origin: string
): Promise<TokenResponse> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials not configured");
  }
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: getRedirectUri(origin),
    grant_type: "authorization_code"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token exchange failed (${r.status}): ${text}`);
  }
  return (await r.json()) as TokenResponse;
}

/** Refresh an expired access_token using the stored refresh_token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials not configured");
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Refresh failed (${r.status}): ${text}`);
  }
  return (await r.json()) as { access_token: string; expires_in: number };
}

/** Fetch the Google email + sub (stable id) of the authorized account. */
export async function fetchUserInfo(accessToken: string): Promise<{
  email: string;
  sub: string;
}> {
  const r = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) {
    throw new Error(`userinfo failed: ${r.status}`);
  }
  const j = (await r.json()) as { id: string; email: string };
  return { email: j.email, sub: j.id };
}

/** Upsert the credential row after successful OAuth exchange.
 * One row per role — re-connecting the same role overwrites the existing row. */
export async function storeCredentials(args: {
  email: string;
  sub: string;
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  scopes: string;
  userRole: string;  // "admin" | "health" — which role this credential belongs to
}): Promise<void> {
  const sb = serverClient();
  await sb
    .from("gmail_credentials")
    .upsert(
      {
        user_role: args.userRole,                // conflict key
        google_email: args.email,
        google_sub: args.sub,
        refresh_token: args.refreshToken,
        access_token: args.accessToken,
        access_token_expiry: new Date(Date.now() + args.expiresInSec * 1000).toISOString(),
        scopes: args.scopes,
        revoked_at: null,
        connected_at: new Date().toISOString()
      },
      { onConflict: "user_role" }
    );
}

/** Returns a valid access_token for the given role's Google connection.
 * Refreshes automatically if expired. Returns null if not connected.
 * @param role  "admin" (default) or "health" — which role's credential to use */
export async function getValidAccessToken(role = "admin"): Promise<{
  accessToken: string;
  email: string;
} | null> {
  const sb = serverClient();
  const { data } = await sb
    .from("gmail_credentials")
    .select("id, google_email, refresh_token, access_token, access_token_expiry")
    .eq("user_role", role)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;

  const expiry = data.access_token_expiry ? new Date(data.access_token_expiry as string).getTime() : 0;
  const stillValid = data.access_token && expiry > Date.now() + 30_000; // 30s safety
  if (stillValid) {
    return { accessToken: data.access_token as string, email: data.google_email as string };
  }

  // Refresh — if credentials are missing or the refresh token is revoked,
  // return null instead of throwing so callers get a 412, not a 500.
  try {
    const fresh = await refreshAccessToken(data.refresh_token as string);
    await sb
      .from("gmail_credentials")
      .update({
        access_token: fresh.access_token,
        access_token_expiry: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        last_used_at: new Date().toISOString()
      })
      .eq("id", data.id);
    return { accessToken: fresh.access_token, email: data.google_email as string };
  } catch {
    // Refresh failed (credentials not configured, token revoked, network error).
    // Return null — caller will surface "Gmail not connected" to the admin.
    return null;
  }
}

/** Status check for the dashboard. Defaults to admin role for backward compat.
 * @param role  "admin" (default) or "health" */
export async function getConnectionStatus(role = "admin"): Promise<{
  connected: boolean;
  email?: string;
  connectedAt?: string;
}> {
  const sb = serverClient();
  const { data } = await sb
    .from("gmail_credentials")
    .select("google_email, connected_at")
    .eq("user_role", role)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { connected: false };
  return {
    connected: true,
    email: data.google_email as string,
    connectedAt: data.connected_at as string
  };
}

/** Soft-disconnect (sets revoked_at). The refresh_token in our DB is no
 * longer used; user must re-consent to reconnect.
 * @param role  if provided, only disconnects that role; otherwise disconnects all */
export async function disconnect(role?: string): Promise<void> {
  const sb = serverClient();
  const ts = new Date().toISOString();
  if (role) {
    await sb
      .from("gmail_credentials")
      .update({ revoked_at: ts })
      .eq("user_role", role)
      .is("revoked_at", null);
  } else {
    await sb
      .from("gmail_credentials")
      .update({ revoked_at: ts })
      .is("revoked_at", null);
  }
}
