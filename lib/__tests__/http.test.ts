import { describe, it, expect } from "vitest";
import { safeJson } from "../http";

describe("safeJson", () => {
  it("returns parsed JSON for a valid body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 })
    });
    expect(await safeJson(req)).toEqual({ a: 1 });
  });

  it("returns {} for an invalid JSON body", async () => {
    const req = new Request("http://x", { method: "POST", body: "not-json{" });
    expect(await safeJson(req)).toEqual({});
  });

  it("returns {} for an empty body", async () => {
    const req = new Request("http://x", { method: "POST" });
    expect(await safeJson(req)).toEqual({});
  });

  it("works on Response objects too", async () => {
    const res = new Response("oops", { status: 500 });
    expect(await safeJson(res)).toEqual({});
  });
});
