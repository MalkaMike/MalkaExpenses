import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import type { Role } from "@/lib/auth/admin";
import { fromDb } from "@/lib/money";

export type AccountWithBalances = {
  id: string;
  name: string;
  bank: string;
  type: "checking" | "savings" | "credit_card";
  sharedBalance: number;
  realBalance: number | null; // only populated when role = "admin"
};

// Row shape returned by the account_tx_sums() RPC (migration 0035).
export type AccountTxSums = {
  account_id: string;
  real_total: number; // cents, SUM(real_amount) over is_fake = false
  shared_total: number; // cents, SUM(shared_amount) over is_fake = false
  shared_total_view: number; // cents, SUM(shared_amount) over ALL rows (view semantics)
};

// Compute every account's shared and (in admin role) real balance.
// Shared balance always comes through shared_account_balances_v (a SQL
// aggregate over shared_transactions_v) — hidden rows are excluded and,
// critically, the sum is computed by Postgres over ALL rows. The previous
// implementation fetched raw rows and summed in JS, which silently truncated
// at PostgREST's max_rows=1000 once the ledger passed 1000 transactions.
export async function getAccountsWithBalances(role: Role): Promise<AccountWithBalances[]> {
  const sb = serverClient();
  const shared = sharedClient();

  const [accountsRes, sharedRes, sumsRes] = await Promise.all([
    sb
      .from("accounts")
      .select("id, name, bank, type, real_starting_balance, shared_starting_balance")
      .eq("is_archived", false)
      .order("name"),
    shared.from("shared_account_balances_v").select("account_id, total"),
    // Only "admin" role sees real amounts; "household" and "public" see shared only
    role === "admin"
      ? sb.rpc("account_tx_sums")
      : Promise.resolve({ data: null, error: null })
  ]);

  if (accountsRes.error) throw accountsRes.error;
  const accounts = accountsRes.data;
  if (!accounts) return [];
  if (sharedRes.error) throw sharedRes.error;
  if (sumsRes.error) throw sumsRes.error;

  const sharedSum = new Map<string, number>();
  for (const r of sharedRes.data ?? []) {
    sharedSum.set(r.account_id, fromDb(Number(r.total)));
  }

  const realSum = new Map<string, number>();
  for (const r of (sumsRes.data ?? []) as AccountTxSums[]) {
    realSum.set(r.account_id, fromDb(Number(r.real_total)));
  }

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    bank: a.bank,
    type: a.type,
    sharedBalance: fromDb(Number(a.shared_starting_balance)) + (sharedSum.get(a.id) ?? 0),
    realBalance:
      role === "admin"
        ? fromDb(Number(a.real_starting_balance)) + (realSum.get(a.id) ?? 0)
        : null
  }));
}
