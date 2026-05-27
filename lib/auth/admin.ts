import "server-only";
import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { serverClient } from "@/lib/supabase/server";
import { hasHouseholdCookie } from "./household";

// ============================================================================
// Admin auth — single shared password for Mickael's admin surface (/admin/*).
// Wife uses the main site freely (no auth). Mickael logs in to /admin to see
// real_amount, edit shared_amount, hide transactions, add fake entries.
// ============================================================================
//
// Cookie format:    pf_admin = v1.<lastActivityIso>.<sig>
// Sig:              HMAC-SHA256(MODE_COOKIE_SECRET, "v1." + lastActivityIso)
// Sliding window:   each authenticated request refreshes lastActivityIso
// Idle timeout:     ADMIN_TIMEOUT_MINUTES (default 60)
// ============================================================================

export type Role = "public" | "household" | "admin";
export const COOKIE_NAME = "pf_admin";

function sign(payload: string): string {
  return createHmac("sha256", env.MODE_COOKIE_SECRET).update(payload).digest("hex");
}

function verify(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function packToken(lastActivityMs: number): string {
  const payload = `v1.${lastActivityMs}`;
  return `${payload}.${sign(payload)}`;
}

function unpackToken(token: string): { lastActivity: Date } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!verify(payload, parts[2])) return null;
  const ms = Number(parts[1]);
  if (!Number.isFinite(ms)) return null;
  return { lastActivity: new Date(ms) };
}

// ----------------------------------------------------------------------------
// Read current role. Returns:
//   "admin"     — pf_admin cookie present + valid (full access; sees real_amount)
//   "household" — pf_household cookie present + valid (main site only)
//   "public"    — neither cookie (must log in via /login)
// Side-effect-free.
// ----------------------------------------------------------------------------
export async function getRole(): Promise<Role> {
  // Admin first (highest privilege)
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (token) {
    const parsed = unpackToken(token);
    if (parsed) {
      const elapsedMin = (Date.now() - parsed.lastActivity.getTime()) / 60000;
      if (elapsedMin <= env.ADMIN_TIMEOUT_MINUTES) return "admin";
    }
  }
  if (await hasHouseholdCookie()) return "household";
  return "public";
}

// ----------------------------------------------------------------------------
// Password validation against the env-var bcrypt hash.
// ----------------------------------------------------------------------------
export async function validatePassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  try {
    return await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Login / logout — write cookie + audit
// ----------------------------------------------------------------------------
export async function loginAdmin(): Promise<void> {
  const c = await cookies();
  const token = packToken(Date.now());
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.ADMIN_TIMEOUT_MINUTES * 60
  });
  await writeAudit("admin.login");
}

export async function logoutAdmin(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
  await writeAudit("admin.logout");
}

// Refresh the sliding-window timestamp. Call from middleware on each /admin/*
// or /api/admin/* request to keep the session alive.
export async function refreshAdmin(): Promise<void> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return;
  const parsed = unpackToken(token);
  if (!parsed) return;
  const elapsedMin = (Date.now() - parsed.lastActivity.getTime()) / 60000;
  if (elapsedMin > env.ADMIN_TIMEOUT_MINUTES) {
    c.delete(COOKIE_NAME);
    return;
  }
  c.set(COOKIE_NAME, packToken(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.ADMIN_TIMEOUT_MINUTES * 60
  });
}

// ----------------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------------
export async function writeAudit(
  action: string,
  data?: {
    transactionId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }
): Promise<void> {
  try {
    const h = await headers();
    const role = await getRole();
    const sb = serverClient();
    await sb.from("audit_log").insert({
      actor: "mickael",
      mode: role,
      action,
      transaction_id: data?.transactionId ?? null,
      old_value: data?.oldValue ?? null,
      new_value: data?.newValue ?? null,
      ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null,
      user_agent: h.get("user-agent") ?? null
    });
  } catch {
    // never block on audit failure
  }
}

// Enforce admin role in API route handlers
export async function requireAdmin(): Promise<void> {
  if ((await getRole()) !== "admin") {
    throw new Response("Not Found", { status: 404 });
  }
}
