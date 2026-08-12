import { describe, it, expect, beforeAll } from "vitest";

// lib/env validates at import time, so schema-valid placeholders must exist
// before the module under test pulls it in. Built at runtime rather than
// written as literals — a fixture that *looks* like a credential trips the
// repo's secret scanner, and rightly so.
const filler = (n: number) => "x".repeat(n);

beforeAll(() => {
  const e = process.env;
  e.NEXT_PUBLIC_SUPABASE_URL ??= "https://dummy.supabase.co";
  e.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= filler(30);
  e.SUPABASE_SERVICE_ROLE_KEY ??= filler(30);
  e.ADMIN_PASSWORD_HASH ??= filler(30);
  e.HOUSEHOLD_PASSWORD_HASH ??= filler(30);
  e.MODE_COOKIE_SECRET ??= filler(40);
});

describe("secretary link", () => {
  it("derives a 40-char hex token", async () => {
    const { secretaryLinkToken } = await import("../secretary-link");
    expect(secretaryLinkToken()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is stable across calls — a link already handed out must keep working", async () => {
    const { secretaryLinkToken } = await import("../secretary-link");
    expect(secretaryLinkToken()).toBe(secretaryLinkToken());
  });

  it("builds the path from the token", async () => {
    const { secretaryLinkPath, secretaryLinkToken } = await import("../secretary-link");
    expect(secretaryLinkPath()).toBe(`/celina/${secretaryLinkToken()}`);
  });

  it("accepts the real token", async () => {
    const { isValidSecretaryLink, secretaryLinkToken } = await import("../secretary-link");
    expect(isValidSecretaryLink(secretaryLinkToken())).toBe(true);
  });

  it("rejects near-misses, wrong lengths and wrong case", async () => {
    const { isValidSecretaryLink, secretaryLinkToken } = await import("../secretary-link");
    const real = secretaryLinkToken();
    for (const bad of [
      "",
      "abc",
      "0".repeat(40),
      real.slice(0, 39),
      `${real}0`,
      real.toUpperCase()
    ]) {
      expect(isValidSecretaryLink(bad)).toBe(false);
    }
  });

  it("does not throw on non-string input", async () => {
    const { isValidSecretaryLink } = await import("../secretary-link");
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(isValidSecretaryLink(bad as never)).toBe(false);
    }
  });
});
