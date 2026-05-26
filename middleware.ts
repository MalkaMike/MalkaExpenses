import { NextResponse, type NextRequest } from "next/server";

// ============================================================================
// Middleware: gate /private/* and /api/private/* on the pf_mode cookie.
// Returns 404 (NOT 401/403) when the cookie is absent or invalid — so wife,
// poking at the URL bar, sees nothing more than "page not found".
// ============================================================================
// Runs on the edge runtime, so we use Web Crypto (not node:crypto).
// Keep verifyToken in sync with the cookie format in lib/auth/mode.ts.

const COOKIE_NAME = "pf_mode";
const TIMEOUT_MIN = Number(process.env.PRIVATE_MODE_TIMEOUT_MINUTES ?? "15");

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

function isPrivatePath(pathname: string): boolean {
  return pathname.startsWith("/private") || pathname.startsWith("/api/private");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isPrivatePath(pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/private/:path*", "/api/private/:path*"]
};
