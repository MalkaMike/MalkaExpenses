import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { loginAdmin, validatePassword } from "@/lib/auth/admin";
import { loginHousehold, validateHouseholdPassword } from "@/lib/auth/household";
import { loginHealth, validateHealthPassword } from "@/lib/auth/health";
import { loginSecretary, validateSecretaryPassword } from "@/lib/auth/secretary";
import { serverClient } from "@/lib/supabase/server";
import { safeJson } from "@/lib/http";

export const runtime = "nodejs";

const ADMIN_USERNAME = "Malka_Admin";
const HOUSEHOLD_USERNAME = "Malka";
const AYELET_USERNAME = "Ayelet_Malka";   // health_admin — /admin/health + main site
const CELINA_USERNAME = "Celine";          // secretary — /admin/health/queue only

const WINDOW_MIN = 15;
// Strict limit keys on the (ip, username) PAIR — a shared household IP can't
// lock one user out because another mistyped their own password. The pure-IP
// cap stays only as a wide DoS backstop, and per-username catches cross-IP
// credential stuffing.
const MAX_FAILS_PER_IP_USER = 8;
const MAX_FAILS_PER_IP = 50;
const MAX_FAILS_PER_USERNAME = 8;
const FAIL_DELAY_MS = 600;

const Body = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
});

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function recordAttempt(ip: string, username: string, success: boolean): Promise<void> {
  try {
    const sb = serverClient();
    const { error } = await sb.from("login_attempts").insert({ ip, username, success });
    // supabase-js does NOT throw on DB errors — without this check a failed
    // insert silently stops the brute-force counter from counting.
    if (error) console.error("[login] recordAttempt insert failed:", error.message);
  } catch (e) {
    // never crash login on audit failure — but never hide it either
    console.error("[login] recordAttempt threw:", (e as Error).message);
  }
}

async function isRateLimited(ip: string, username: string): Promise<boolean> {
  try {
    const sb = serverClient();
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const [ipUserRes, ipRes, userRes] = await Promise.all([
      sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("username", username).eq("success", false).gte("attempted_at", since),
      sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("success", false).gte("attempted_at", since),
      sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("username", username).eq("success", false).gte("attempted_at", since)
    ]);
    // supabase-js returns { count: null, error } instead of throwing — the old
    // destructuring treated a DB error as "0 failures" and FAILED OPEN.
    const failedQuery = ipUserRes.error ?? ipRes.error ?? userRes.error;
    if (failedQuery) {
      console.error("[login] rate-limit count query failed — refusing logins:", failedQuery.message);
      return true;
    }
    return (
      (ipUserRes.count ?? 0) >= MAX_FAILS_PER_IP_USER ||
      (ipRes.count ?? 0) >= MAX_FAILS_PER_IP ||
      (userRes.count ?? 0) >= MAX_FAILS_PER_USERNAME
    );
  } catch (e) {
    // Fail CLOSED: if the attempt store is unreachable we cannot count
    // failures, and login itself doesn't need the DB (bcrypt vs env hash) —
    // failing open would hand an attacker an unthrottled brute-force window
    // for exactly as long as the outage lasts.
    console.error("[login] rate-limit store unreachable — refusing logins:", (e as Error).message);
    return true;
  }
}

// One person can hold several role passwords (Ayelet: household + health).
// A successful login makes the NEW role the only active one — stale sibling
// cookies would otherwise survive and confuse role precedence and audit
// attribution (getRole picks the highest-ranked valid cookie).
async function clearOtherRoleCookies(keep: string): Promise<void> {
  const jar = await cookies();
  for (const name of ["pf_admin", "pf_health", "pf_secretary", "pf_household"]) {
    if (name !== keep) jar.delete(name);
  }
}

async function rejectInvalid(): Promise<NextResponse> {
  await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
  return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await safeJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });

  const { username, password } = parsed.data;
  const ip = clientIp(req);

  if (await isRateLimited(ip, username)) {
    await recordAttempt(ip, username, false);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "too many attempts — try again later" }, { status: 429 });
  }

  if (username === ADMIN_USERNAME) {
    const ok = await validatePassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await clearOtherRoleCookies("pf_admin");
    await loginAdmin();
    return NextResponse.json({ ok: true, role: "admin" });
  }

  if (username === HOUSEHOLD_USERNAME) {
    const ok = await validateHouseholdPassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await clearOtherRoleCookies("pf_household");
    await loginHousehold();
    return NextResponse.json({ ok: true, role: "household" });
  }

  if (username === AYELET_USERNAME) {
    const ok = await validateHealthPassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await clearOtherRoleCookies("pf_health");
    await loginHealth();
    return NextResponse.json({ ok: true, role: "health" });
  }

  if (username === CELINA_USERNAME) {
    const ok = await validateSecretaryPassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await clearOtherRoleCookies("pf_secretary");
    await loginSecretary();
    return NextResponse.json({ ok: true, role: "secretary" });
  }

  await recordAttempt(ip, username, false);
  return rejectInvalid();
}
