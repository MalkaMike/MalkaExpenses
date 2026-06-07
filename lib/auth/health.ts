import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

// Ayelet's health-admin auth. Grants access to /admin/health/* and the main site.
// Same HMAC-signed cookie pattern as household.ts — role is "health" in the payload.
//
// Set HEALTH_PASSWORD_HASH in .env.local:
//   node -e "const b=require('bcryptjs');console.log(b.hashSync('chosen_password',10))"

export const HEALTH_COOKIE_NAME = "pf_health";
const HEALTH_TIMEOUT_DAYS = 90;
const TOKEN_ROLE: "health" = "health";
const FUTURE_SKEW_MS = 60_000;

function sign(payload: string): string {
  return createHmac("sha256", env.MODE_COOKIE_SECRET).update(payload).digest("hex");
}
function verify(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
function packToken(): string {
  const ms = Date.now();
  const payload = `v2.${TOKEN_ROLE}.${ms}`;
  return `${payload}.${sign(payload)}`;
}
function unpackToken(token: string): { issuedAt: Date } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2" || parts[1] !== TOKEN_ROLE) return null;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  if (!verify(payload, parts[3])) return null;
  const ms = Number(parts[2]);
  if (!Number.isFinite(ms)) return null;
  if (ms > Date.now() + FUTURE_SKEW_MS) return null;
  return { issuedAt: new Date(ms) };
}

export async function hasHealthCookie(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(HEALTH_COOKIE_NAME)?.value;
  if (!token) return false;
  const parsed = unpackToken(token);
  if (!parsed) return false;
  return (Date.now() - parsed.issuedAt.getTime()) / 86400000 <= HEALTH_TIMEOUT_DAYS;
}

export async function validateHealthPassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  if (!env.HEALTH_PASSWORD_HASH) return false;
  try {
    return await bcrypt.compare(password, env.HEALTH_PASSWORD_HASH);
  } catch {
    return false;
  }
}

export async function loginHealth(): Promise<void> {
  const c = await cookies();
  c.set(HEALTH_COOKIE_NAME, packToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: HEALTH_TIMEOUT_DAYS * 86400,
  });
}

export async function logoutHealth(): Promise<void> {
  const c = await cookies();
  c.delete(HEALTH_COOKIE_NAME);
}
