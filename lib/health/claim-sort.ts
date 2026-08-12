/**
 * Column ordering for the secretary's claim table.
 *
 * Lives outside the client component so it can be tested: this decides which
 * claim she looks at first, and a comparator that quietly sinks the blank rows
 * to the wrong end — or sorts money as text — changes what gets worked on.
 */

import { STATE_ORDER, type ClaimState } from "./claim-status";
import type { ClaimOwner } from "./claim-guidance";

export type SortKey = "date" | "provider" | "patient" | "amount" | "state" | "owner";

/** Only the fields the table sorts on — the row type is free to carry more. */
export type SortableClaim = {
  emissionDate: string | null;
  providerName: string | null;
  patient: string | null;
  amount: number | null;
  state: ClaimState;
  guidance: { owner: ClaimOwner };
};

const OWNER_RANK: Record<ClaimOwner, number> = { secretary: 0, mickael: 1, blocked: 2 };

function sortValue(c: SortableClaim, key: SortKey): number | string | null {
  switch (key) {
    case "date": return c.emissionDate;
    case "provider": return c.providerName;
    case "patient": return c.patient;
    case "amount": return c.amount;
    case "state": return STATE_ORDER.indexOf(c.state);
    case "owner": return OWNER_RANK[c.guidance.owner];
  }
}

/**
 * Blanks always sort last, in BOTH directions — a row with no value is never
 * the answer to "show me the biggest" or "show me the oldest", so flipping the
 * direction must not float it to the top.
 */
export function compareClaims(
  a: SortableClaim,
  b: SortableClaim,
  key: SortKey,
  dir: 1 | -1
): number {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const r =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "pt-BR");
  return r * dir;
}

/** Ties break on amount, biggest first — same column value, bigger money on top. */
export function sortClaims<T extends SortableClaim>(claims: T[], key: SortKey, dir: 1 | -1): T[] {
  return [...claims].sort(
    (a, b) => compareClaims(a, b, key, dir) || (b.amount ?? 0) - (a.amount ?? 0)
  );
}

/** Money and dates read most usefully biggest/newest first; text reads A→Z. */
export function defaultDir(key: SortKey): 1 | -1 {
  return key === "amount" || key === "date" ? -1 : 1;
}
