// ============================================================================
// Shared HMAC-SHA256 token helpers — works in both edge (middleware) and Node
// runtimes (lib/auth/*.ts). Uses globalThis.crypto.subtle which is available
// in both since Node 18.
//
// Token format (v2):  v2.<role>.<timestampMs>.<hexSig>
// Secret:             process.env.MODE_COOKIE_SECRET (≥ 32 chars, fail-closed)
// ============================================================================

// Not "server-only" — middleware (edge) imports this.

const enc = new TextEncoder();
const MIN_SECRET_LENGTH = 32;
const FUTURE_SKEW_MS = 60_000;

let _keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!_keyPromise) {
    const secret = process.env.MODE_COOKIE_SECRET ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      _keyPromise = Promise.reject(
        new Error(`MODE_COOKIE_SECRET missing or < ${MIN_SECRET_LENGTH} chars — fail-closed.`)
      );
      const p = _keyPromise;
      p.catch(() => { _keyPromise = null; });
      return p;
    }
    _keyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return _keyPromise;
}

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function signPayload(payload: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(sig);
}

/** Build a signed token: `v2.<role>.<ms>.<hexSig>` */
export async function packToken(role: string, ms: number = Date.now()): Promise<string> {
  const payload = `v2.${role}.${ms}`;
  const sig = await signPayload(payload);
  return `${payload}.${sig}`;
}

/**
 * Verify and unpack a token.
 * Returns the timestamp (ms) on success, or null on any failure (bad sig, wrong role, expired future).
 * Age check (max-age) is the caller's responsibility.
 */
export async function unpackToken(token: string, expectedRole: string): Promise<number | null> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2" || parts[1] !== expectedRole) return null;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  let expected: string;
  try {
    expected = await signPayload(payload);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expected, parts[3])) return null;
  const ms = Number(parts[2]);
  if (!Number.isFinite(ms)) return null;
  if (ms > Date.now() + FUTURE_SKEW_MS) return null;
  return ms;
}
