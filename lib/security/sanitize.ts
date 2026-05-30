// Single source of truth for what a NON-ADMIN (household/public) caller may
// ever receive for a transaction. The dual-ledger privacy wall depends on this:
// real_amount, is_fake, and notes_private must never cross to the household.
//
// Used by API routes that can be hit by household (e.g. PATCH /transactions/:id)
// to strip the row before responding. Pure + unit-tested so the invariant is
// locked in CI.

export const HOUSEHOLD_FORBIDDEN_FIELDS = [
  "real_amount",
  "is_fake",
  "notes_private",
  "created_by"
] as const;

// The exact safe shape the household may see for a transaction.
export type HouseholdSafeTransaction = {
  id: string;
  account_id: string;
  date: string;
  description_clean: string | null;
  shared_amount: number;
  category_id: string | null;
  status: string;
  is_transfer: boolean;
};

/**
 * Reduce a full transaction row to the fields a household caller may receive.
 * Returns ONLY the safe subset — anything not listed is dropped, so adding a
 * new sensitive column to the table can never silently leak through here.
 */
export function householdSafeTransaction(
  row: Record<string, unknown>
): HouseholdSafeTransaction {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    date: String(row.date),
    description_clean:
      row.description_clean === null || row.description_clean === undefined
        ? null
        : String(row.description_clean),
    shared_amount: Number(row.shared_amount),
    category_id:
      row.category_id === null || row.category_id === undefined
        ? null
        : String(row.category_id),
    status: String(row.status),
    is_transfer: Boolean(row.is_transfer)
  };
}
