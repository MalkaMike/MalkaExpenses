import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginAdmin, validatePassword } from "@/lib/auth/admin";
import { loginHousehold, validateHouseholdPassword } from "@/lib/auth/household";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Username gate — kept in code on purpose (only 2 known users). If you want to
// rotate or add users, move to env or a small `users` table.
const ADMIN_USERNAME = "Malka_Admin";
const HOUSEHOLD_USERNAME = "Malka";

// Durable rate limit: count failed attempts in `login_attempts` over a window.
// IP and username are checked separately so a single attacker can't pivot per
// account and an attacker can't lock a legit user out from a different IP.
const WINDOW_MIN = 15;
const MAX_FAILS_PER_IP = 20;       // distributed accounts probing one host
const MAX_FAILS_PER_USERNAME = 8;  // brute force one account from many IPs
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

async function recordAttempt(
  ip: string,
  username: string,
  success: boolean
): Promise<void> {
  try {
    const sb = serverClient();
    await sb.from("login_attempts").insert({ ip, username, success });
  } catch {
    // Never let attempt-logging failure crash login
  }
}

async function isRateLimited(
  ip: string,
  username: string
): Promise<boolean> {
  try {
    const sb = serverClient();
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const [{ count: ipFails }, { count: userFails }] = await Promise.all([
      sb
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .eq("success", false)
        .gte("attempted_at", since),
      sb
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("username", username)
        .eq("success", false)
        .gte("attempted_at", since)
    ]);
    return (
      (ipFails ?? 0) >= MAX_FAILS_PER_IP ||
      (userFails ?? 0) >= MAX_FAILS_PER_USERNAME
    );
  } catch {
    // If the rate-limit store is down, fail OPEN here — login still throttles
    // via 600ms delay and the rest of the stack. We prefer login working over
    // being locked out by a Supabase blip.
    return false;
  }
}

async function rejectInvalid(): Promise<NextResponse> {
  await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
  return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });

  const { username, password } = parsed.data;
  const ip = clientIp(req);

  if (await isRateLimited(ip, username)) {
    // Still record the attempt so the lockout window keeps extending if they
    // keep banging; don't reveal the lockout explicitly.
    await recordAttempt(ip, username, false);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json(
      { error: "too many attempts — try again later" },
      { status: 429 }
    );
  }

  if (username === ADMIN_USERNAME) {
    const ok = await validatePassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await loginAdmin();
    return NextResponse.json({ ok: true, role: "admin" });
  }

  if (username === HOUSEHOLD_USERNAME) {
    const ok = await validateHouseholdPassword(password);
    await recordAttempt(ip, username, ok);
    if (!ok) return rejectInvalid();
    await loginHousehold();
    return NextResponse.json({ ok: true, role: "household" });
  }

  // Unknown username — still record + delay to avoid timing oracle
  await recordAttempt(ip, username, false);
  return rejectInvalid();
}
