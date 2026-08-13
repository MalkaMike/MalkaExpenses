import { describe, it, expect } from "vitest";
import { isAlwaysOpen, isHealthPath, isAdminGated } from "../route-access";

describe("isHealthPath", () => {
  it("covers the health pages and their API", () => {
    expect(isHealthPath("/admin/health")).toBe(true);
    expect(isHealthPath("/admin/health/queue")).toBe(true);
    expect(isHealthPath("/api/admin/health/queue")).toBe(true);
  });

  // The regression: the secretary's PDF button lives outside /api/admin/health,
  // so middleware treated it as admin-only and 302'd her back to her own queue.
  it("lets the health roles reach an invoice PDF", () => {
    expect(
      isHealthPath("/api/admin/nota-fiscais/f0176722-5e44-41d3-8943-c2101ea345f1/pdf")
    ).toBe(true);
  });

  it("does NOT open the rest of the nota-fiscais API", () => {
    expect(isHealthPath("/api/admin/nota-fiscais")).toBe(false);
    expect(isHealthPath("/api/admin/nota-fiscais/abc")).toBe(false);
    expect(isHealthPath("/api/admin/nota-fiscais/abc/delete")).toBe(false);
    // No traversal into a deeper path that merely ends in /pdf.
    expect(isHealthPath("/api/admin/nota-fiscais/abc/secret/pdf")).toBe(false);
    expect(isHealthPath("/admin/nota-fiscais")).toBe(false);
  });

  it("keeps the other admin areas closed", () => {
    expect(isHealthPath("/admin/transactions")).toBe(false);
    expect(isHealthPath("/api/admin/merchants")).toBe(false);
  });
});

describe("isAlwaysOpen", () => {
  it("opens login, logout, webhook, cron and the secretary link", () => {
    expect(isAlwaysOpen("/login")).toBe(true);
    expect(isAlwaysOpen("/api/admin/login")).toBe(true);
    expect(isAlwaysOpen("/api/pluggy/webhook")).toBe(true);
    expect(isAlwaysOpen("/api/cron/pluggy-sync")).toBe(true);
    expect(isAlwaysOpen("/celina/sometoken")).toBe(true);
  });

  it("does not open the app itself", () => {
    expect(isAlwaysOpen("/admin/health/queue")).toBe(false);
    expect(isAlwaysOpen("/transactions")).toBe(false);
    expect(isAlwaysOpen("/api/admin/health/queue")).toBe(false);
  });
});

describe("isAdminGated", () => {
  it("gates the admin area and its API", () => {
    expect(isAdminGated("/admin/transactions")).toBe(true);
    expect(isAdminGated("/api/admin/anything")).toBe(true);
  });

  it("leaves the main site alone", () => {
    expect(isAdminGated("/")).toBe(false);
    expect(isAdminGated("/transactions")).toBe(false);
  });
});
