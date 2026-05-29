import type { serverClient } from "@/lib/supabase/server";
import {
  matchCcPayment,
  shouldAutoLink,
  isCcPaymentDescription,
  type BankTxInput,
  type CcStatementInput,
  type CcMatchCandidate
} from "@/lib/reconciliation/cc-matcher";

type SB = ReturnType<typeof serverClient>;

export type ReconcileResult = {
  scanned: number;
  autoLinked: number;
  needsReview: Array<{
    bankTx: BankTxInput & { accountId: string };
    candidates: CcMatchCandidate[];
  }>;
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

/**
 * Scan unreconciled bank outflows that look like CC bill payments and link the
 * unambiguous ones to their CC statement (marking the bank line as a transfer
 * so it stops double-counting). Ambiguous / low-confidence matches are returned
 * in `needsReview` for the user to resolve — never auto-linked.
 *
 * Pure-ish: all I/O goes through the passed Supabase client; the matching
 * decision lives in the unit-tested cc-matcher module.
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

  // 1) Candidate bank payments: outflows from checking/savings accounts.
  let bankQ = sb
    .from("transactions")
    .select("id, date, real_amount, description_raw, account_id, accounts!inner(type)")
    .lt("real_amount", 0)
    .eq("is_transfer", false)
    .in("accounts.type", ["checking", "savings"]);
  if (accountId) bankQ = bankQ.eq("account_id", accountId);
  const { data: bankRows } = await bankQ.limit(1000);

  // 2) CC statements with closing balance + due date.
  const { data: stmtRows } = await sb
    .from("statement_imports")
    .select("id, account_id, closing_balance, due_date, accounts!inner(name, cc_issuer, type)")
    .not("closing_balance", "is", null)
    .not("due_date", "is", null)
    .eq("accounts.type", "credit_card");

  const statements: CcStatementInput[] = (stmtRows ?? []).map((r) => {
    const acc = one(
      r.accounts as
        | { name: string; cc_issuer: string | null }
        | { name: string; cc_issuer: string | null }[]
        | null
    );
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      accountName: acc?.name ?? "—",
      closingBalance: r.closing_balance === null ? null : Number(r.closing_balance),
      dueDate: (r.due_date as string | null) ?? null,
      ccIssuer: acc?.cc_issuer ?? null
    };
  });

  // 3) Exclude already-reconciled bank txs.
  const { data: existing } = await sb
    .from("cc_reconciliations")
    .select("bank_transaction_id");
  const reconciled = new Set((existing ?? []).map((e) => e.bank_transaction_id as string));

  // 4) Match.
  let scanned = 0;
  let autoLinked = 0;
  const needsReview: ReconcileResult["needsReview"] = [];

  for (const row of bankRows ?? []) {
    const id = row.id as string;
    if (reconciled.has(id)) continue;
    const description = (row.description_raw as string) ?? "";
    if (!isCcPaymentDescription(description)) continue;

    scanned += 1;
    const bankTx: BankTxInput = {
      id,
      date: row.date as string,
      amount: Number(row.real_amount),
      description
    };
    const candidates = matchCcPayment(bankTx, statements);
    if (candidates.length === 0) continue;

    if (shouldAutoLink(candidates)) {
      const best = candidates[0];
      const { error: recErr } = await sb.from("cc_reconciliations").insert({
        bank_transaction_id: id,
        cc_statement_import_id: best.statementId,
        match_confidence: best.confidence,
        user_confirmed: false
      });
      if (recErr) {
        needsReview.push({ bankTx: { ...bankTx, accountId: row.account_id as string }, candidates });
        continue;
      }
      await sb
        .from("transactions")
        .update({
          is_transfer: true,
          status: "auto_accepted",
          ...(payCatId ? { category_id: payCatId } : {})
        })
        .eq("id", id);
      autoLinked += 1;
    } else {
      needsReview.push({
        bankTx: { ...bankTx, accountId: row.account_id as string },
        candidates
      });
    }
  }

  return { scanned, autoLinked, needsReview };
}
