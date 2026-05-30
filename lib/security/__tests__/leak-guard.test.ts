import { describe, it, expect } from "vitest";
import {
  householdSafeTransaction,
  HOUSEHOLD_FORBIDDEN_FIELDS
} from "../sanitize";

// A full transaction row as it comes back from `.select()` — includes every
// sensitive column.
const fullRow = {
  id: "tx-1",
  account_id: "acc-1",
  date: "2026-05-30",
  description_raw: "IFD*KAISEKI",
  description_clean: "Kaiseki",
  real_amount: -490, // TRUTH — must never leak
  shared_amount: -200, // curated
  is_fake: true, // must never leak
  notes_private: "hidden from wife", // must never leak
  category_id: "cat-1",
  status: "user_edited",
  is_transfer: false,
  created_by: "import",
  external_id: "pluggy-xyz"
};

describe("householdSafeTransaction — the privacy wall", () => {
  const safe = householdSafeTransaction(fullRow);
  const serialized = JSON.stringify(safe);

  it("never exposes any forbidden field", () => {
    for (const field of HOUSEHOLD_FORBIDDEN_FIELDS) {
      expect(safe).not.toHaveProperty(field);
      // Belt and suspenders: the value must not appear anywhere in the payload.
      expect(serialized).not.toContain('"' + field + '"');
    }
  });

  it("never exposes the real amount value or private note", () => {
    expect(serialized).not.toContain("490"); // real_amount magnitude
    expect(serialized).not.toContain("hidden from wife");
  });

  it("returns only the eight safe fields", () => {
    expect(Object.keys(safe).sort()).toEqual(
      [
        "account_id",
        "category_id",
        "date",
        "description_clean",
        "id",
        "is_transfer",
        "shared_amount",
        "status"
      ].sort()
    );
  });

  it("passes through the shared (curated) amount, not the real one", () => {
    expect(safe.shared_amount).toBe(-200);
  });

  it("handles null-ish optional fields without leaking", () => {
    const minimal = householdSafeTransaction({
      id: "x",
      account_id: "a",
      date: "2026-01-01",
      description_clean: null,
      shared_amount: 0,
      category_id: null,
      status: "pending_review",
      is_transfer: false,
      real_amount: -9999,
      is_fake: false
    });
    expect(minimal.description_clean).toBeNull();
    expect(minimal.category_id).toBeNull();
    expect(JSON.stringify(minimal)).not.toContain("9999");
  });
});
