import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

/**
 * Password-free access for the secretary: one long secret URL instead of a
 * credential nobody can remember. The bcrypt hash in CELINA_PASSWORD_HASH is
 * one-way, so the forgotten password was unrecoverable — and Mickael did not
 * want to touch Vercel env vars to set a new one.
 *
 * The token is DERIVED, never stored: HMAC(MODE_COOKIE_SECRET, "secretary-link-<version>").
 * That means no secret in git, no new environment variable, and rotation is a
 * one-character edit to VERSION below — which instantly kills every old link.
 *
 * The link is the credential. Anyone holding it reads the family's medical
 * claims, so it is long, never logged, and rotatable.
 */

// Bump this to invalidate every link already handed out.
const VERSION = "v1";
const TOKEN_CHARS = 40; // 160 bits of hex — not guessable

function derive(version: string): string {
  return createHmac("sha256", env.MODE_COOKIE_SECRET)
    .update(`secretary-link-${version}`)
    .digest("hex")
    .slice(0, TOKEN_CHARS);
}

/** The current token. Shown to admin so the link can be sent to Celina. */
export function secretaryLinkToken(): string {
  return derive(VERSION);
}

/** The full path to hand over. */
export function secretaryLinkPath(): string {
  return `/celina/${secretaryLinkToken()}`;
}

/**
 * Constant-time comparison — a plain `===` on a secret leaks its prefix through
 * response timing, which is exactly how a guessable token gets guessed.
 */
export function isValidSecretaryLink(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== TOKEN_CHARS) return false;
  const expected = Buffer.from(secretaryLinkToken(), "utf8");
  const got = Buffer.from(candidate, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}
