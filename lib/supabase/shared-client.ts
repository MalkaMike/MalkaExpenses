import "server-only";
import { serverClient } from "./server";
import { assertSafeTable, assertSafeColumns } from "./guard";

// ============================================================================
// THE SECURITY WALL
// ============================================================================
// The shared code path uses this module — NOT serverClient() directly.
// It enforces, at runtime, that no shared-view query touches:
//   - the `transactions` table directly  (must use `shared_transactions_v`)
//   - the columns `real_amount`, `is_fake`, `notes_private`
// If any leak guard fails, the request crashes before any HTTP response
// is sent. The guard predicates live in ./guard (pure, unit-tested); the
// integration leak-guard test will catch regressions in CI.
// ============================================================================

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
