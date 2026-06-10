import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { verifyCronSecret } from "../cron";

// ============================================================================
// Locks the cron auth gate: constant-time compare, fail-closed on unset
// secret. All four /api/cron/* routes depend on this single function.
// ============================================================================

const ORIGINAL = process.env.CRON_SECRET;

function reqWithAuth(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("authorization", value);
  return new Request("http://localhost/api/cron/test", { headers });
}

describe("verifyCronSecret", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret-0123456789";
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it("accepts the exact Bearer token", () => {
    expect(verifyCronSecret(reqWithAuth("Bearer test-secret-0123456789"))).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(verifyCronSecret(reqWithAuth("Bearer test-secret-9876543210"))).toBe(false);
  });

  it("rejects a token with different length", () => {
    expect(verifyCronSecret(reqWithAuth("Bearer short"))).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(verifyCronSecret(reqWithAuth(null))).toBe(false);
  });

  it("rejects the bare secret without the Bearer prefix", () => {
    expect(verifyCronSecret(reqWithAuth("test-secret-0123456789"))).toBe(false);
  });

  it("fails CLOSED when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(reqWithAuth("Bearer anything"))).toBe(false);
  });

  it("fails CLOSED when CRON_SECRET is empty string", () => {
    process.env.CRON_SECRET = "";
    expect(verifyCronSecret(reqWithAuth("Bearer "))).toBe(false);
  });
});
