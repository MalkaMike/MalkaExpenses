// Pluggy sometimes gives the SAME bank row a NEW transaction id (card
// instalments re-dated when a bill closes; a reconnected item). Dedup by id
// cannot see that, so the app kept both copies — migration 0058 removed 190.
//
// pairReissued() matches each incoming row to an existing row of the same
// account whose id Pluggy no longer returns ("orphan"): same amount, and
// either the same instalment (same leading text + same trailing NN/MM) or a
// date within `maxDays`. 1:1, closest date wins. The caller re-links the
// orphan (keeps its hand review) instead of inserting a second copy.
// Pure — unit-tested in __tests__/reissued.test.ts.
import { daysBetween } from "@/lib/reconciliation/cc-matcher";

export type LedgerRow = { date: string; description_raw: string; real_amount: number };

const INSTALMENT_RE = /(\d{2}\/\d{2})\s*$/;

function sameInstalment(a: string, b: string): boolean {
  const ia = a.match(INSTALMENT_RE)?.[1];
  return ia !== undefined && ia === b.match(INSTALMENT_RE)?.[1] && a.slice(0, 12) === b.slice(0, 12);
}

// Pluggy keeps the PENDING forecast of a card instalment after the POSTED one
// lands on a closed bill (measured 15/10: "NICOM 08/08" POSTED 14/09 on a bill
// AND PENDING 20/10 with no bill). Returns the ids of those stale forecasts so
// the sync treats them like ids Pluggy no longer returns.
export function supersededForecasts(
  txs: Array<{ id: string; status?: string | null; description: string; amount: number }>
): Set<string> {
  const posted = txs.filter((t) => t.status === "POSTED" && INSTALMENT_RE.test(t.description));
  const out = new Set<string>();
  for (const t of txs) {
    if (t.status !== "PENDING" || !INSTALMENT_RE.test(t.description)) continue;
    if (posted.some((p) => p.amount === t.amount && sameInstalment(p.description, t.description))) out.add(t.id);
  }
  return out;
}

export function pairReissued<N extends LedgerRow, O extends LedgerRow>(
  incoming: N[],
  orphans: O[],
  maxDays = 5
): Array<{ orphan: O; row: N }> {
  const free = new Set(orphans);
  const pairs: Array<{ orphan: O; row: N }> = [];
  for (const row of incoming) {
    let best: O | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const o of free) {
      if (Number(o.real_amount) !== Number(row.real_amount)) continue;
      const gap = daysBetween(o.date, row.date);
      if (gap > maxDays && !sameInstalment(o.description_raw, row.description_raw)) continue;
      if (gap < bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    if (best) {
      free.delete(best);
      pairs.push({ orphan: best, row });
    }
  }
  return pairs;
}
