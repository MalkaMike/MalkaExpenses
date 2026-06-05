import { NextResponse, type NextRequest } from "next/server";

// ============================================================================
// Middleware — two-tier auth gate (runs on the edge runtime; uses Web Crypto).
//
// Tiers:
//   Anonymous          : only /login + auth APIs
//   Household (pf_household)  : main site (everything except /admin/* surface)
//   Admin (pf_admin)   : full access including /admin/*
//
// Token format (v2 — role-bound):
//   <cookie> = v2.<role>.<ms>.<sig>
//   Sig:      HMAC-SHA256(MODE_COOKIE_SECRET, "v2.${role}.${ms}")
// Keep verifyToken in sync with cookie format in lib/auth/admin.ts + household.ts.
// ============================================================================

const ADMIN_COOKIE = "pf_admin";
const HOUSEHOLD_COOKIE = "pf_household";
// Default: 8 hours. Override with ADMIN_TIMEOUT_MINUTES env var.
const ADMIN_TIMEOUT_MIN = Number(process.env.ADMIN_TIMEOUT_MINUTES ?? "480");
const HOUSEHOLD_TIMEOUT_DAYS = 90;
const FUTURE_SKEW_MS = 60_000;
const MIN_SECRET_LENGTH = 32;

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

// Fail-closed: refuse to construct a verification key when the secret is
// missing or too short. Returns a rejected promise so verifyToken catches and
// returns false → every request becomes anonymous instead of forgeable.
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.MODE_COOKIE_SECRET ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      keyPromise = Promise.reject(
        new Error(
          `MODE_COOKIE_SECRET missing or < ${MIN_SECRET_LENGTH} chars — refusing to verify cookies (fail-closed).`
        )
      );
      // Don't cache the rejection forever — let env reload retry next request.
      const p = keyPromise;
      p.catch(() => {
        keyPromise = null;
      });
      return p;
    }
    keyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return keyPromise;
}

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifyToken(
  token: string,
  expectedRole: "admin" | "household",
  maxAgeMs: number
): Promise<boolean> {
  const parts = token.split(".");
  // Strict format: v2.<role>.<ms>.<sig>
  if (parts.length !== 4 || parts[0] !== "v2" || parts[1] !== expectedRole) return false;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  let expected: string;
  try {
    const key = await getKey();
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    expected = toHex(sig);
  } catch {
    return false;
  }
  if (!constantTimeEqual(expected, parts[3])) return false;
  const ms = Number(parts[2]);
  if (!Number.isFinite(ms)) return false;
  // Reject future-dated tokens (clock attack / forged signature with future time)
  if (ms > Date.now() + FUTURE_SKEW_MS) return false;
  return Date.now() - ms <= maxAgeMs;
}

async function hasAdmin(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!t) return false;
  return verifyToken(t, "admin", ADMIN_TIMEOUT_MIN * 60 * 1000);
}
async function hasHousehold(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HOUSEHOLD_COOKIE)?.value;
  if (!t) return false;
  return verifyToken(t, "household", HOUSEHOLD_TIMEOUT_DAYS * 86400 * 1000);
}

// Create a fresh admin token (Web Crypto — same HMAC as lib/auth/admin.ts).
// Used to refresh the sliding-window on every successful admin request.
async function createAdminToken(): Promise<string> {
  const payload = `v2.admin.${Date.now()}`;
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${toHex(sig)}`;
}

// Always-open paths (auth flows + static + self-secured machine endpoints).
// EXACT matches preferred; prefix matches reserved for whole subtrees we own.
function isAlwaysOpen(pathname: string): boolean {
  // Exact open paths
  if (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/api/login" ||
    pathname === "/api/household/login" ||
    pathname === "/api/household/logout" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout"
  ) {
    return true;
  }
  // Subtree open paths (we own these subtrees end-to-end)
  return (
    pathname.startsWith("/api/pluggy/webhook") ||
    pathname.startsWith("/api/cron/")
  );
}

function isAdminGated(pathname: string): boolean {
  return pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isAlwaysOpen(pathname)) return NextResponse.next();

  const admin = await hasAdmin(req);

  // /admin/* and /api/admin/* require admin specifically
  if (isAdminGated(pathname)) {
    if (admin) {
      // Sliding-window refresh: update the cookie timestamp on every successful
      // admin request so the session stays alive while Mickael is working.
      const response = NextResponse.next();
      try {
        const newToken = await createAdminToken();
        response.cookies.set(ADMIN_COOKIE, newToken, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: ADMIN_TIMEOUT_MIN * 60
        });
      } catch {
        // token refresh failed — don't block the request, just let cookie expire naturally
      }
      return response;
    }
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Not Found", { status: 404 });
    }
    // Session expired → redirect to /admin (which shows login form) with clean URL
    const url = new URL("/admin", req.nextUrl.origin);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Everything else: household OR admin
  if (admin || (await hasHousehold(req))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets
  matcher: ["/((?!_next/|favicon|manifest|robots|sitemap|.*\\.).*)"]
};
