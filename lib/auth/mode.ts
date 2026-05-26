import "server-only";
import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { serverClient } from "@/lib/supabase/server";

export type Mode = "shared" | "private";
export const COOKIE_NAME = "pf_mode";

// ----------------------------------------------------------------------------
// Cookie token format:   v1.<lastActivityIso>.<sig>
// Where sig = HMAC-SHA256(MODE_COOKIE_SECRET, "v1." + lastActivityIso)
// ----------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac("sha256", env.MODE_COOKIE_SECRET).update(payload).digest("hex");
}

function verify(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function packToken(lastActivityIso: string): string {
  const payload = `v1.${lastActivityIso}`;
  return `${payload}.${sign(payload)}`;
}

function unpackToken(token: string): { lastActivity: Date } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!verify(payload, parts[2])) return null;
  const d = new Date(parts[1]);
  if (Number.isNaN(d.getTime())) return null;
  return { lastActivity: d };
}

// ----------------------------------------------------------------------------
// Read current mode from cookie. Returns "shared" unless cookie present,
// valid, and last_activity within timeout. Side-effect-free.
// ----------------------------------------------------------------------------
export async function getMode(): Promise<Mode> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return "shared";
  const parsed = unpackToken(token);
  if (!parsed) return "shared";
  const elapsedMin = (Date.now() - parsed.lastActivity.getTime()) / 60000;
  if (elapsedMin > env.PRIVATE_MODE_TIMEOUT_MINUTES) return "shared";
  return "private";
}

// ----------------------------------------------------------------------------
// PIN validation. Looks up bcrypt hash in app_settings and compares.
// Returns true on success and writes audit log entry.
// ----------------------------------------------------------------------------
export async function validatePin(pin: string): Promise<boolean> {
  if (!/^\d{4,12}$/.test(pin)) return false;
  const sb = serverClient();
  const { data, error } = await sb
    .from("app_settings")
    .select("private_pin_hash")
    .eq("id", 1)
    .single();
  if (error || !data?.private_pin_hash) return false;
  return bcrypt.compare(pin, data.private_pin_hash);
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("PIN must be 4-12 digits");
  const hash = await bcrypt.hash(pin, 10);
  const sb = serverClient();
  const { error } = await sb.from("app_settings").update({ private_pin_hash: hash }).eq("id", 1);
  if (error) throw error;
}

export async function isPinConfigured(): Promise<boolean> {
  const sb = serverClient();
  const { data } = await sb
    .from("app_settings")
    .select("private_pin_hash")
    .eq("id", 1)
    .single();
  return Boolean(data?.private_pin_hash);
}

// ----------------------------------------------------------------------------
// Mode transitions — write cookie + audit
// ----------------------------------------------------------------------------
export async function enterPrivateMode(): Promise<void> {
  const c = await cookies();
  const token = packToken(new Date().toISOString());
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.PRIVATE_MODE_TIMEOUT_MINUTES * 60
  });
  await writeAudit("mode.enter_private");
}

export async function exitPrivateMode(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
  await writeAudit("mode.exit_private");
}

// Refresh the sliding-window timestamp. Call from middleware on each /private/*
// or /api/private/* request to keep the session alive.
export async function refreshMode(): Promise<void> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return;
  const parsed = unpackToken(token);
  if (!parsed) return;
  const elapsedMin = (Date.now() - parsed.lastActivity.getTime()) / 60000;
  if (elapsedMin > env.PRIVATE_MODE_TIMEOUT_MINUTES) {
    c.delete(COOKIE_NAME);
    return;
  }
  c.set(COOKIE_NAME, packToken(new Date().toISOString()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.PRIVATE_MODE_TIMEOUT_MINUTES * 60
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
    const mode = await getMode();
    const sb = serverClient();
    await sb.from("audit_log").insert({
      actor: "mickael",
      mode,
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

// Enforce private mode or throw — used in /api/private route handlers
export async function requirePrivate(): Promise<void> {
  if ((await getMode()) !== "private") {
    throw new Response("Not Found", { status: 404 });
  }
}
