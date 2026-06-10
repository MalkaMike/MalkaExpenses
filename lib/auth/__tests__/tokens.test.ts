import { describe, it, expect, beforeAll } from "vitest";
import { packToken, unpackToken } from "../tokens";

beforeAll(() => {
  process.env.MODE_COOKIE_SECRET = "test-secret-thats-at-least-32-characters-long";
});

describe("packToken / unpackToken", () => {
  it("round-trips a valid token", async () => {
    const token = await packToken("admin");
    const ms = await unpackToken(token, "admin");
    expect(ms).not.toBeNull();
    expect(typeof ms).toBe("number");
  });

  it("rejects wrong role", async () => {
    const token = await packToken("admin");
    expect(await unpackToken(token, "household")).toBeNull();
  });

  it("rejects tampered payload", async () => {
    const token = await packToken("health");
    const parts = token.split(".");
    parts[2] = String(Date.now() - 1000); // different timestamp
    expect(await unpackToken(parts.join("."), "health")).toBeNull();
  });

  it("rejects tampered signature", async () => {
    const token = await packToken("household");
    const parts = token.split(".");
    parts[3] = parts[3].replace(/a/g, "b"); // corrupt hex sig
    expect(await unpackToken(parts.join("."), "household")).toBeNull();
  });

  it("rejects future-issued tokens", async () => {
    const futureMs = Date.now() + 120_000; // 2 min in the future
    const token = await packToken("secretary", futureMs);
    expect(await unpackToken(token, "secretary")).toBeNull();
  });

  it("returns the timestamp that was packed", async () => {
    const issuedAt = Date.now() - 5000;
    const token = await packToken("admin", issuedAt);
    const ms = await unpackToken(token, "admin");
    expect(ms).toBe(issuedAt);
  });

  it("rejects malformed token with only 3 parts", async () => {
    expect(await unpackToken("v2.admin.12345", "admin")).toBeNull();
  });
});
