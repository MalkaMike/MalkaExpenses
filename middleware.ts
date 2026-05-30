import { NextResponse, type NextRequest } from "next/server";

// ============================================================================
// Middleware — two-tier auth gate (runs on the edge runtime; uses Web Crypto).
//
// Tiers:
//   Anonymous          : only /login, /admin (login screens) + their auth APIs
//   Household (pf_household)  : main site (everything except /admin/* surface)
//   Admin (pf_admin)   : full access including /admin/*
//
// Behavior:
//   - /api/admin/login, /api/household/login, /api/household/logout, /api/admin/logout : open
//   - /login                    : open (renders household login)
//   - /admin                    : open (renders admin login when not admin)
//   - /admin/*, /api/admin/*    : require pf_admin cookie (redirect or 404)
//   - everything else           : require pf_household OR pf_admin (redirect to /login)
//
// Keep verifyToken in sync with cookie format in lib/auth/admin.ts + household.ts.
// ============================================================================

const ADMIN_COOKIE = "pf_admin";
const HOUSEHOLD_COOKIE = "pf_household";
const ADMIN_TIMEOUT_MIN = Number(process.env.ADMIN_TIMEOUT_MINUTES ?? "60");
const HOUSEHOLD_TIMEOUT_DAYS = 90;

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.MODE_COOKIE_SECRET ?? "";
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

async function verifyToken(token: string, maxAgeMs: number): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  let expected: string;
  try {
    const key = await getKey();
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    expected = toHex(sig);
  } catch {
    return false;
  }
  if (!constantTimeEqual(expected, parts[2])) return false;
  const ms = Number(parts[1]);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= maxAgeMs;
}

async function hasAdmin(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!t) return false;
  return verifyToken(t, ADMIN_TIMEOUT_MIN * 60 * 1000);
}
async function hasHousehold(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HOUSEHOLD_COOKIE)?.value;
  if (!t) return false;
  return verifyToken(t, HOUSEHOLD_TIMEOUT_DAYS * 86400 * 1000);
}

// Always-open paths (auth flows + static + self-secured machine endpoints).
// Match prefixes. The Pluggy webhook and the cron endpoint carry no session
// cookie by design — they authenticate with their own secrets (webhook ?token=
// and cron Authorization: Bearer CRON_SECRET), so they must skip the cookie gate.
function isAlwaysOpen(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname.startsWith("/api/household/login") ||
    pathname.startsWith("/api/household/logout") ||
    pathname.startsWith("/api/admin/login") ||
    pathname.startsWith("/api/admin/logout") ||
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
    if (admin) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Not Found", { status: 404 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Everything else: household OR admin
  if (admin || (await hasHousehold(req))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets
  matcher: ["/((?!_next/|favicon|manifest|robots|sitemap|.*\\.).*)"]
};
