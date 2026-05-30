import { describe, it, expect } from "vitest";
import {
  assertSafeTable,
  assertSafeColumns,
  FORBIDDEN_TABLES,
  FORBIDDEN_COLUMNS
} from "../guard";

// ============================================================================
// The runtime backstop behind the privacy wall. Page queries are role-gated
// to read shared_transactions_v for household; this guard crashes the request
// if any shared-path query slips through to a forbidden table or column.
// These tests lock that backstop so a refactor can't silently weaken it.
// ============================================================================

describe("assertSafeTable", () => {
  it("throws for every forbidden table", () => {
    for (const table of ["transactions", "audit_log", "app_settings"]) {
      expect(() => assertSafeTable(table), table).toThrow(/forbidden table/);
    }
  });

  it("allows the shared view and non-sensitive tables", () => {
    for (const table of [
      "shared_transactions_v",
      "accounts",
      "categories",
      "budgets",
      "merchant_rules"
    ]) {
      expect(() => assertSafeTable(table), table).not.toThrow();
    }
  });

  it("keeps transactions itself off-limits (must use the view)", () => {
    expect(() => assertSafeTable("transactions")).toThrow();
    expect(() => assertSafeTable("shared_transactions_v")).not.toThrow();
    expect(FORBIDDEN_TABLES.has("transactions")).toBe(true);
  });
});

describe("assertSafeColumns", () => {
  it("throws when a forbidden column appears anywhere in the select", () => {
    expect(() => assertSafeColumns("real_amount")).toThrow(/forbidden column/);
    // realistic dangerous select: real next to the legit shared column
    expect(() => assertSafeColumns("id, real_amount, shared_amount")).toThrow(/real_amount/);
    expect(() => assertSafeColumns("id, is_fake")).toThrow(/is_fake/);
    expect(() => assertSafeColumns("notes_private, date")).toThrow(/notes_private/);
    expect(() => assertSafeColumns("private_pin_hash")).toThrow(/private_pin_hash/);
  });

  it("allows the canonical shared-view select expressions", () => {
    const safeSelects = [
      "id, account_id, date, description, amount, category_slug, is_transfer",
      "account_id, amount",
      "date, amount, is_transfer",
      "id, amount, categories(slug)",
      "shared_amount", // legit curated column
      "id"
    ];
    for (const cols of safeSelects) {
      expect(() => assertSafeColumns(cols), cols).not.toThrow();
    }
  });

  it("does not let the legit shared_amount column trip the real_amount guard", () => {
    // Regression: shared_amount must never be mistaken for real_amount.
    expect(() => assertSafeColumns("shared_amount")).not.toThrow();
    expect("shared_amount".includes("real_amount")).toBe(false);
  });

  it("exposes the full forbidden-column set", () => {
    expect(FORBIDDEN_COLUMNS).toEqual(
      expect.arrayContaining(["real_amount", "is_fake", "notes_private", "private_pin_hash"])
    );
  });
});
