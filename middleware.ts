import { NextResponse, type NextRequest } from "next/server";

// ============================================================================
// Middleware — multi-role auth gate (runs on the edge runtime; uses Web Crypto).
//
// Roles and path access:
//   admin      pf_admin      → all paths
//   health     pf_health     → /admin/health/* + /api/admin/health/* + main site
//   secretary  pf_secretary  → /admin/health/* + /api/admin/health/* (queue only)
//   household  pf_household  → main site only
//   public     none          → /login only
//
// Secretary reaching a non-queue path → redirected to /admin/health/queue.
// Health reaching a non-health admin path → redirected to /admin/health.
// ============================================================================

const ADMIN_COOKIE = "pf_admin";
const HOUSEHOLD_COOKIE = "pf_household";
const HEALTH_COOKIE = "pf_health";
const SECRETARY_COOKIE = "pf_secretary";

const ADMIN_TIMEOUT_MIN = Number(process.env.ADMIN_TIMEOUT_MINUTES ?? "480");
const HOUSEHOLD_TIMEOUT_DAYS = 90;
const HEALTH_TIMEOUT_DAYS = 90;
const SECRETARY_TIMEOUT_DAYS = 90;
const FUTURE_SKEW_MS = 60_000;
const MIN_SECRET_LENGTH = 32;

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.MODE_COOKIE_SECRET ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      keyPromise = Promise.reject(
        new Error(`MODE_COOKIE_SECRET missing or < ${MIN_SECRET_LENGTH} chars — fail-closed.`)
      );
      const p = keyPromise;
      p.catch(() => { keyPromise = null; });
      return p;
    }
    keyPromise = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
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

async function verifyToken(token: string, expectedRole: string, maxAgeMs: number): Promise<boolean> {
  const parts = token.split(".");
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
  if (ms > Date.now() + FUTURE_SKEW_MS) return false;
  return Date.now() - ms <= maxAgeMs;
}

async function hasAdmin(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(ADMIN_COOKIE)?.value;
  return t ? verifyToken(t, "admin", ADMIN_TIMEOUT_MIN * 60 * 1000) : false;
}
async function hasHousehold(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HOUSEHOLD_COOKIE)?.value;
  return t ? verifyToken(t, "household", HOUSEHOLD_TIMEOUT_DAYS * 86400 * 1000) : false;
}
async function hasHealth(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HEALTH_COOKIE)?.value;
  return t ? verifyToken(t, "health", HEALTH_TIMEOUT_DAYS * 86400 * 1000) : false;
}
async function hasSecretary(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(SECRETARY_COOKIE)?.value;
  return t ? verifyToken(t, "secretary", SECRETARY_TIMEOUT_DAYS * 86400 * 1000) : false;
}

async function createAdminToken(): Promise<string> {
  const payload = `v2.admin.${Date.now()}`;
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${toHex(sig)}`;
}

function isAlwaysOpen(pathname: string): boolean {
  if (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname === "/api/household/login" ||
    pathname === "/api/household/logout" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout"
  ) return true;
  return (
    pathname.startsWith("/api/pluggy/webhook") ||
    pathname.startsWith("/api/cron/")
  );
}

function isHealthPath(pathname: string): boolean {
  return pathname.startsWith("/admin/health") || pathname.startsWith("/api/admin/health");
}

function isAdminGated(pathname: string): boolean {
  return pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

function redirectTo(url: string, req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(url, req.nextUrl.origin));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isAlwaysOpen(pathname)) return NextResponse.next();

  const admin = await hasAdmin(req);

  // Admin: full access + sliding-window refresh
  if (admin) {
    const response = NextResponse.next();
    try {
      const newToken = await createAdminToken();
      response.cookies.set(ADMIN_COOKIE, newToken, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/",
        maxAge: ADMIN_TIMEOUT_MIN * 60,
      });
    } catch { /* refresh failure is non-fatal */ }
    return response;
  }

  const health = await hasHealth(req);
  const secretary = await hasSecretary(req);
  const household = !health && !secretary && await hasHousehold(req);

  // Health paths: admin (handled above) | health | secretary → pass
  if (isHealthPath(pathname)) {
    if (health || secretary) return NextResponse.next();
    if (pathname.startsWith("/api/")) return new NextResponse("Not Found", { status: 404 });
    return redirectTo(`/login?next=${encodeURIComponent(pathname)}`, req);
  }

  // Other admin paths: only admin (handled above) — redirect others sensibly
  if (isAdminGated(pathname)) {
    if (health) return redirectTo("/admin/health", req);
    if (secretary) return redirectTo("/admin/health/queue", req);
    if (pathname.startsWith("/api/")) return new NextResponse("Not Found", { status: 404 });
    const url = new URL("/admin", req.nextUrl.origin);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Main site: admin (above) | health | household → pass; secretary → queue
  if (health || household) return NextResponse.next();
  if (secretary) return redirectTo("/admin/health/queue", req);

  if (pathname.startsWith("/api/")) return new NextResponse("Not Found", { status: 404 });
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon|manifest|robots|sitemap|.*\\.).*)"]
};
