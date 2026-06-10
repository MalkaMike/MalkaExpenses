import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { packToken, unpackToken } from "./tokens";

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

export async function hasHouseholdCookie(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(HOUSEHOLD_COOKIE_NAME)?.value;
  if (!token) return false;
  const ms = await unpackToken(token, TOKEN_ROLE);
  if (ms === null) return false;
  return (Date.now() - ms) / 86400000 <= HOUSEHOLD_TIMEOUT_DAYS;
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
  c.set(HOUSEHOLD_COOKIE_NAME, await packToken(TOKEN_ROLE), {
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
