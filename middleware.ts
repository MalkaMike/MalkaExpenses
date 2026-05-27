import { NextResponse, type NextRequest } from "next/server";

// ============================================================================
// Middleware: gate /admin/* and /api/admin/* on the pf_admin cookie.
// Returns 404 (not 401/403) when cookie absent or invalid — looks like the
// route doesn't exist. Wife typing /admin sees the login page only because
// /admin itself is whitelisted below; everything deeper is gated.
// ============================================================================
// Runs on the edge runtime, so we use Web Crypto.
// Keep verifyToken in sync with the cookie format in lib/auth/admin.ts.

const COOKIE_NAME = "pf_admin";
const TIMEOUT_MIN = Number(process.env.ADMIN_TIMEOUT_MINUTES ?? "60");

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

async function verifyToken(token: string): Promise<boolean> {
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
  const d = new Date(parts[1]);
  if (Number.isNaN(d.getTime())) return false;
  const elapsedMin = (Date.now() - d.getTime()) / 60000;
  return elapsedMin <= TIMEOUT_MIN;
}

// Paths that must require an admin session. The /admin landing page is open
// (so it can show the login form); everything below it is gated.
function isGatedPath(pathname: string): boolean {
  if (pathname === "/admin" || pathname === "/admin/") return false;
  if (pathname.startsWith("/api/admin/login")) return false; // login endpoint
  return pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isGatedPath(pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    // For API routes: 404. For pages: redirect to /admin (login form).
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Not Found", { status: 404 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
