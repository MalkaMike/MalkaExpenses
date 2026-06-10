import { timingSafeEqual } from "node:crypto";

// ============================================================================
// Cron auth — Vercel sends `Authorization: Bearer <CRON_SECRET>` on every
// scheduled invocation when the env var is set (vercel.json crons).
//
// Constant-time compare (timingSafeEqual) so the secret can't be recovered
// by timing the responses. Fails CLOSED: an unset CRON_SECRET means every
// caller is rejected — a misconfigured deploy never leaves cron routes open.
//
// No "server-only" import: this module is pure (header string compare) and
// unit-tested under vitest's node environment, same pattern as lib/supabase/guard.
// ============================================================================

export function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  // Length check is required by timingSafeEqual; leaking length is acceptable
  // (the header format is public knowledge anyway).
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
