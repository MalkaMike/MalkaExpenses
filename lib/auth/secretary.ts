import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { packToken, unpackToken } from "./tokens";

// Celina's secretary auth. Grants access to /admin/health/* only.
// Middleware redirects any non-health path back to /admin/health/queue.
//
// Set CELINA_PASSWORD_HASH in .env.local:
//   node -e "const b=require('bcryptjs');console.log(b.hashSync('chosen_password',10))"

export const SECRETARY_COOKIE_NAME = "pf_secretary";
const SECRETARY_TIMEOUT_DAYS = 90;
const TOKEN_ROLE = "secretary" as const;

export async function hasSecretaryCookie(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(SECRETARY_COOKIE_NAME)?.value;
  if (!token) return false;
  const ms = await unpackToken(token, TOKEN_ROLE);
  if (ms === null) return false;
  return (Date.now() - ms) / 86400000 <= SECRETARY_TIMEOUT_DAYS;
}

export async function validateSecretaryPassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  if (!env.CELINA_PASSWORD_HASH) return false;
  try {
    return await bcrypt.compare(password, env.CELINA_PASSWORD_HASH);
  } catch {
    return false;
  }
}

export async function loginSecretary(): Promise<void> {
  const c = await cookies();
  c.set(SECRETARY_COOKIE_NAME, await packToken(TOKEN_ROLE), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SECRETARY_TIMEOUT_DAYS * 86400,
  });
}

export async function logoutSecretary(): Promise<void> {
  const c = await cookies();
  c.delete(SECRETARY_COOKIE_NAME);
}
