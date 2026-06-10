import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { packToken, unpackToken } from "./tokens";

// Ayelet's health-admin auth. Grants access to /admin/health/* and the main site.
// Same HMAC-signed cookie pattern as household.ts — role is "health" in the payload.
//
// Set HEALTH_PASSWORD_HASH in .env.local:
//   node -e "const b=require('bcryptjs');console.log(b.hashSync('chosen_password',10))"

export const HEALTH_COOKIE_NAME = "pf_health";
const HEALTH_TIMEOUT_DAYS = 90;
const TOKEN_ROLE = "health" as const;

export async function hasHealthCookie(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(HEALTH_COOKIE_NAME)?.value;
  if (!token) return false;
  const ms = await unpackToken(token, TOKEN_ROLE);
  if (ms === null) return false;
  return (Date.now() - ms) / 86400000 <= HEALTH_TIMEOUT_DAYS;
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
  c.set(HEALTH_COOKIE_NAME, await packToken(TOKEN_ROLE), {
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
