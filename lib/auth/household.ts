import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

// ============================================================================
// Household auth — the lighter gate. Wife enters this password once and sees
// the main (shared) site. Different from the admin password, which unlocks
// the /admin surface with real_amount and editing.
//
// Role hierarchy:  admin > household > public
// Either cookie passes the main-site gate; only pf_admin passes the /admin gate.
//
// Cookie format (v2 — role-bound; see lib/auth/admin.ts header):
//   pf_household = v2.household.<issuedAtMs>.<sig>
// ============================================================================

export const HOUSEHOLD_COOKIE_NAME = "pf_household";
const HOUSEHOLD_TIMEOUT_DAYS = 90; // long-lived; wife shouldn't have to re-enter weekly
const TOKEN_ROLE = "household" as const;
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
  // Reject future-issued tokens
  if (ms > Date.now() + FUTURE_SKEW_MS) return null;
  return { issuedAt: new Date(ms) };
}

export async function hasHouseholdCookie(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(HOUSEHOLD_COOKIE_NAME)?.value;
  if (!token) return false;
  const parsed = unpackToken(token);
  if (!parsed) return false;
  const ageDays = (Date.now() - parsed.issuedAt.getTime()) / 86400000;
  return ageDays <= HOUSEHOLD_TIMEOUT_DAYS;
}

export async function validateHouseholdPassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  if (!env.HOUSEHOLD_PASSWORD_HASH) return false;
  try {
    return await bcrypt.compare(password, env.HOUSEHOLD_PASSWORD_HASH);
  } catch {
    return false;
  }
}

export async function loginHousehold(): Promise<void> {
  const c = await cookies();
  c.set(HOUSEHOLD_COOKIE_NAME, packToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: HOUSEHOLD_TIMEOUT_DAYS * 86400
  });
}

export async function logoutHousehold(): Promise<void> {
  const c = await cookies();
  c.delete(HOUSEHOLD_COOKIE_NAME);
}
