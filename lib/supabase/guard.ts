// ============================================================================
// SHARED-PATH LEAK GUARD — pure predicates
// ============================================================================
// Extracted from shared-client.ts so the security-critical logic can be unit
// tested without the "server-only" / env coupling of the Supabase client.
// These crash any shared (household-facing) query that touches a forbidden
// table or selects a forbidden column — the runtime backstop behind the
// role-gated page queries.
// ============================================================================

// Tables a shared (household) code path must never query directly.
//   - transactions   → has real_amount/is_fake/notes_private; use shared_transactions_v
//   - audit_log      → records mode switches + hide/fake actions (reveals the ledger)
//   - app_settings   → holds the admin PIN hash
export const FORBIDDEN_TABLES = new Set(["transactions", "audit_log", "app_settings"]);

// Columns that must never appear in a shared-view response.
export const FORBIDDEN_COLUMNS = [
  "real_amount",
  "is_fake",
  "notes_private",
  "private_pin_hash"
];

export function assertSafeTable(table: string): void {
  if (FORBIDDEN_TABLES.has(table)) {
    throw new Error(
      `[shared-client] forbidden table access: "${table}". ` +
        `Shared code paths must query shared_transactions_v instead.`
    );
  }
}

export function assertSafeColumns(cols: string): void {
  for (const c of FORBIDDEN_COLUMNS) {
    if (cols.includes(c)) {
      throw new Error(
        `[shared-client] forbidden column "${c}" in select expression: "${cols}". ` +
          `This column must never appear in a shared-view response.`
      );
    }
  }
}
