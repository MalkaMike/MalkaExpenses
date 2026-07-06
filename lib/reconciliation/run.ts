import "server-only";
import type { serverClient } from "@/lib/supabase/server";
import { isCcPaymentDescription } from "@/lib/reconciliation/cc-matcher";

type SB = ReturnType<typeof serverClient>;

export type ReconcileResult = {
  scanned: number; // CC-payment-looking outflows seen
  autoLinked: number; // # marked as transfer
  needsReview: never[]; // kept for response-shape compatibility (always empty now)
};

/**
 * Mark credit-card BILL PAYMENTS as transfers so they don't double-count.
 *
 * In the Open Finance (Pluggy) model there are no separate CC "statements" to
 * match against — the card purchases already arrive as line items on the card
 * account, and the bank account shows a single "PAG FATURA CARTAO" outflow that
 * settles them. That outflow is an internal transfer, not a real expense, so we
 * detect it by description and mark is_transfer (excluded from spend totals) +
 * category cartao_pagamento.
 *
 * We do NOT touch status or shared_amount — staged rows stay in the admin
 * acceptance inbox for the usual accept/hide decision.
 *
 * (Statement-based amount matching still lives, tested, in ./cc-matcher for if
 *  a statement import path is ever reintroduced for banks Pluggy can't cover.)
 */
export async function runReconcileScan(
  sb: SB,
  accountId?: string
): Promise<ReconcileResult> {
  // Category lookup and the candidate scan are independent → parallel.
  // The scan is paginated (the old .limit(2000) was clamped to PostgREST's
  // max_rows=1000, silently skipping candidates past the cap).
  async function loadCandidates(): Promise<Array<{ id: string; description_raw: string }>> {
    const out: Array<{ id: string; description_raw: string }> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = sb
        .from("transactions")
        .select("id, description_raw, accounts!inner(type)")
        .lt("real_amount", 0)
        .eq("is_transfer", false)
        .in("accounts.type", ["checking", "savings"]);
      if (accountId) q = q.eq("account_id", accountId);
      const { data: page, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`reconcile scan read failed: ${error.message}`);
      out.push(...((page ?? []) as unknown as Array<{ id: string; description_raw: string }>));
      if (!page || page.length < PAGE) break;
    }
    return out;
  }

  const [payCatRes, bankRows] = await Promise.all([
    sb.from("categories").select("id").eq("slug", "cartao_pagamento").single(),
    loadCandidates()
  ]);
  if (payCatRes.error) {
    throw new Error(`reconcile category lookup failed: ${payCatRes.error.message}`);
  }
  const payCatId = payCatRes.data?.id as string | undefined;

  // One batched UPDATE instead of one round-trip per matched row.
  const matchedIds = bankRows
    .filter((row) => isCcPaymentDescription(row.description_raw ?? ""))
    .map((row) => row.id);
  const scanned = matchedIds.length;
  let autoLinked = 0;

  for (let i = 0; i < matchedIds.length; i += 200) {
    const slice = matchedIds.slice(i, i + 200);
    const { error } = await sb
      .from("transactions")
      .update({
        is_transfer: true,
        ...(payCatId ? { category_id: payCatId } : {})
      })
      .in("id", slice);
    if (error) {
      console.error("[reconcile] batch update failed:", error.message);
    } else {
      autoLinked += slice.length;
    }
  }

  return { scanned, autoLinked, needsReview: [] };
}
