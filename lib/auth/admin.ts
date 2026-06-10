import "server-only";
import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { packToken, unpackToken } from "./tokens";
import { hasHouseholdCookie } from "./household";
import { hasHealthCookie } from "./health";
import { hasSecretaryCookie } from "./secretary";

// ============================================================================
// Admin auth — single shared password for Mickael's admin surface (/admin/*).
//
// Role hierarchy (highest → lowest privilege):
//   admin      Mickael — full access including all /admin/* routes
//   health     Ayelet  — /admin/health/* + main site
//   secretary  Celina  — /admin/health/queue only
//   household  Ayelet  — main site only (legacy, still valid)
//   public     unauthenticated
//
// Cookie format (v2 — role-bound):
//   pf_admin = v2.admin.<lastActivityMs>.<sig>
//   Sig: HMAC-SHA256(MODE_COOKIE_SECRET, "v2.admin." + lastActivityMs)
//
// Sliding window: each authenticated request refreshes lastActivityMs
// Idle timeout:   ADMIN_TIMEOUT_MINUTES (default 480 = 8 hours)
// ============================================================================

export type Role = "public" | "household" | "admin" | "health" | "secretary";
export const COOKIE_NAME = "pf_admin";
const TOKEN_ROLE = "admin" as const;

export async function getRole(): Promise<Role> {
  const c = await cookies();

  // Admin (sliding-window, highest privilege)
  const adminToken = c.get(COOKIE_NAME)?.value;
  if (adminToken) {
    const ms = await unpackToken(adminToken, TOKEN_ROLE);
    if (ms !== null) {
      const elapsedMin = (Date.now() - ms) / 60000;
      if (elapsedMin <= env.ADMIN_TIMEOUT_MINUTES) return "admin";
    }
  }

  // Health admin (Ayelet — /admin/health + main site)
  if (await hasHealthCookie()) return "health";

  // Secretary (Celina — /admin/health/queue only)
  if (await hasSecretaryCookie()) return "secretary";

  // Household (Ayelet legacy — main site only)
  if (await hasHouseholdCookie()) return "household";

  return "public";
}

export async function validatePassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  try {
    return await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  } catch {
    return false;
  }
}

export async function loginAdmin(): Promise<void> {
  const c = await cookies();
  const token = await packToken(TOKEN_ROLE, Date.now());
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

export async function refreshAdmin(): Promise<void> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return;
  const ms = await unpackToken(token, TOKEN_ROLE);
  if (ms === null) return;
  const elapsedMin = (Date.now() - ms) / 60000;
  if (elapsedMin > env.ADMIN_TIMEOUT_MINUTES) {
    c.delete(COOKIE_NAME);
    return;
  }
  c.set(COOKIE_NAME, await packToken(TOKEN_ROLE, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.ADMIN_TIMEOUT_MINUTES * 60
  });
}

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
    const { serverClient } = await import("@/lib/supabase/server");
    const sb = serverClient();
    await sb.from("audit_log").insert({
      actor:
        role === "secretary" ? "celina"
        : role === "health" ? "ayelet"
        : "mickael",
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

// ── Role guards for API routes ────────────────────────────────────────────────

// Full admin only
export async function requireAdmin(): Promise<void> {
  if ((await getRole()) !== "admin") {
    throw new Response("Not Found", { status: 404 });
  }
}

// Admin or health_admin (Ayelet) — for /admin/health/* API routes
export async function requireAdminOrHealth(): Promise<void> {
  const r = await getRole();
  if (r !== "admin" && r !== "health") {
    throw new Response("Not Found", { status: 404 });
  }
}

// Admin, health, or secretary — for queue/confirm routes Celina can call
export async function requireAnyHealthRole(): Promise<void> {
  const r = await getRole();
  if (r !== "admin" && r !== "health" && r !== "secretary") {
    throw new Response("Not Found", { status: 404 });
  }
}
