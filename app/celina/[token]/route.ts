import { NextRequest, NextResponse } from "next/server";
import { isValidSecretaryLink } from "@/lib/auth/secretary-link";
import { loginSecretary } from "@/lib/auth/secretary";
import { writeAudit } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /celina/<token> — password-free sign-in for the secretary.
//
// Opens a 90-day secretary session (same cookie and expiry as the password
// login, which still works as a fallback) and drops her on the queue. Held to
// the health module by the middleware, exactly as before.
//
// A wrong token returns 404 rather than 403: an attacker probing the path
// should not learn that it means anything.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  if (!isValidSecretaryLink(token)) {
    // Never log the attempted token — it would put a near-miss guess in plain
    // text in the logs.
    await writeAudit("secretary_link_rejected", { newValue: { ok: false } });
    return new NextResponse("Not Found", { status: 404 });
  }

  await loginSecretary();
  await writeAudit("secretary_link_login", { newValue: { ok: true } });

  return NextResponse.redirect(new URL("/admin/health/queue", _req.nextUrl.origin));
}
