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
  const { data: payCat } = await sb
    .from("categories")
    .select("id")
    .eq("slug", "cartao_pagamento")
    .single();
  const payCatId = payCat?.id as string | undefined;

  // Bank outflows (checking/savings) not already flagged as transfers.
  let bankQ = sb
    .from("transactions")
    .select("id, description_raw, accounts!inner(type)")
    .lt("real_amount", 0)
    .eq("is_transfer", false)
    .in("accounts.type", ["checking", "savings"]);
  if (accountId) bankQ = bankQ.eq("account_id", accountId);
  const { data: bankRows } = await bankQ.limit(2000);

  let scanned = 0;
  let autoLinked = 0;

  for (const row of bankRows ?? []) {
    const desc = (row.description_raw as string) ?? "";
    if (!isCcPaymentDescription(desc)) continue;
    scanned += 1;
    const { error } = await sb
      .from("transactions")
      .update({
        is_transfer: true,
        ...(payCatId ? { category_id: payCatId } : {})
      })
      .eq("id", row.id as string);
    if (!error) autoLinked += 1;
  }

  return { scanned, autoLinked, needsReview: [] };
}
