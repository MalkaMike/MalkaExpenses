import { NextResponse, type NextRequest } from "next/server";
import { packToken, unpackToken } from "./lib/auth/tokens";

// ============================================================================
// Middleware — multi-role auth gate (runs on the edge runtime).
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
// Crypto: shared lib/auth/tokens.ts (Web Crypto, works edge + Node).
// ============================================================================

const ADMIN_COOKIE = "pf_admin";
const HOUSEHOLD_COOKIE = "pf_household";
const HEALTH_COOKIE = "pf_health";
const SECRETARY_COOKIE = "pf_secretary";

const ADMIN_TIMEOUT_MIN = Number(process.env.ADMIN_TIMEOUT_MINUTES ?? "480");
const HOUSEHOLD_TIMEOUT_DAYS = 90;
const HEALTH_TIMEOUT_DAYS = 90;
const SECRETARY_TIMEOUT_DAYS = 90;

async function hasAdmin(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!t) return false;
  const ms = await unpackToken(t, "admin");
  return ms !== null && (Date.now() - ms) <= ADMIN_TIMEOUT_MIN * 60 * 1000;
}
async function hasHousehold(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HOUSEHOLD_COOKIE)?.value;
  if (!t) return false;
  const ms = await unpackToken(t, "household");
  return ms !== null && (Date.now() - ms) / 86400000 <= HOUSEHOLD_TIMEOUT_DAYS;
}
async function hasHealth(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(HEALTH_COOKIE)?.value;
  if (!t) return false;
  const ms = await unpackToken(t, "health");
  return ms !== null && (Date.now() - ms) / 86400000 <= HEALTH_TIMEOUT_DAYS;
}
async function hasSecretary(req: NextRequest): Promise<boolean> {
  const t = req.cookies.get(SECRETARY_COOKIE)?.value;
  if (!t) return false;
  const ms = await unpackToken(t, "secretary");
  return ms !== null && (Date.now() - ms) / 86400000 <= SECRETARY_TIMEOUT_DAYS;
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
    pathname.startsWith("/api/cron/") ||
    // Secretary sign-in link. The route itself validates the token in constant
    // time and 404s on anything else — it must reach the handler rather than be
    // bounced to /login, which is the whole point of a password-free link.
    pathname.startsWith("/celina/")
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
      const newToken = await packToken("admin");
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
