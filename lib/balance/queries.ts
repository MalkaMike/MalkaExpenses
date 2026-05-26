import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import type { Mode } from "@/lib/auth/mode";

export type AccountWithBalances = {
  id: string;
  name: string;
  bank: string;
  type: "checking" | "savings" | "credit_card";
  sharedBalance: number;
  realBalance: number | null; // only populated when mode = "private"
};

// Compute every account's shared and (in private mode) real balance.
// Shared balance always comes through the shared_transactions_v view —
// hidden rows (shared_amount=0) are excluded automatically.
export async function getAccountsWithBalances(mode: Mode): Promise<AccountWithBalances[]> {
  const sb = serverClient();

  // Accounts metadata is not sensitive — fetch via service client either way
  const { data: accounts, error: accErr } = await sb
    .from("accounts")
    .select("id, name, bank, type, real_starting_balance, shared_starting_balance")
    .eq("is_archived", false)
    .order("name");
  if (accErr) throw accErr;
  if (!accounts) return [];

  // Sum shared_amount per account from the VIEW
  const shared = sharedClient();
  const { data: sharedRows, error: sErr } = await shared
    .from("shared_transactions_v")
    .select("account_id, amount");
  if (sErr) throw sErr;

  const sharedSum = new Map<string, number>();
  for (const r of sharedRows ?? []) {
    sharedSum.set(r.account_id, (sharedSum.get(r.account_id) ?? 0) + Number(r.amount));
  }

  // Real sums only fetched in private mode
  let realSum = new Map<string, number>();
  if (mode === "private") {
    const { data: realRows, error: rErr } = await sb
      .from("transactions")
      .select("account_id, real_amount");
    if (rErr) throw rErr;
    for (const r of realRows ?? []) {
      realSum.set(r.account_id, (realSum.get(r.account_id) ?? 0) + Number(r.real_amount));
    }
  }

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    bank: a.bank,
    type: a.type,
    sharedBalance: Number(a.shared_starting_balance) + (sharedSum.get(a.id) ?? 0),
    realBalance:
      mode === "private"
        ? Number(a.real_starting_balance) + (realSum.get(a.id) ?? 0)
        : null
  }));
}
