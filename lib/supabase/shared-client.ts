import "server-only";
import { serverClient } from "./server";

// ============================================================================
// THE SECURITY WALL
// ============================================================================
// The shared code path uses this module — NOT serverClient() directly.
// It enforces, at runtime, that no shared-view query touches:
//   - the `transactions` table directly  (must use `shared_transactions_v`)
//   - the columns `real_amount`, `is_fake`, `notes_private`
// If any leak guard fails, the request crashes before any HTTP response
// is sent. The integration leak-guard test will catch regressions in CI.
// ============================================================================

const FORBIDDEN_TABLES = new Set(["transactions", "audit_log", "app_settings"]);
const FORBIDDEN_COLUMNS = ["real_amount", "is_fake", "notes_private", "private_pin_hash"];

function assertSafeTable(table: string) {
  if (FORBIDDEN_TABLES.has(table)) {
    throw new Error(
      `[shared-client] forbidden table access: "${table}". ` +
        `Shared code paths must query shared_transactions_v instead.`
    );
  }
}

function assertSafeColumns(cols: string) {
  for (const c of FORBIDDEN_COLUMNS) {
    if (cols.includes(c)) {
      throw new Error(
        `[shared-client] forbidden column "${c}" in select expression: "${cols}". ` +
          `This column must never appear in a shared-view response.`
      );
    }
  }
}

export function sharedClient() {
  const sb = serverClient();
  return {
    from(table: string) {
      assertSafeTable(table);
      const builder = sb.from(table);
      const originalSelect = builder.select.bind(builder);
      (builder as unknown as { select: typeof originalSelect }).select = ((
        cols?: string,
        opts?: Parameters<typeof originalSelect>[1]
      ) => {
        if (cols) assertSafeColumns(cols);
        return originalSelect(cols, opts);
      }) as typeof originalSelect;
      return builder;
    }
  };
}
