import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import type { Role } from "@/lib/auth/admin";

export type AccountWithBalances = {
  id: string;
  name: string;
  bank: string;
  type: "checking" | "savings" | "credit_card";
  sharedBalance: number;
  realBalance: number | null; // only populated when role = "admin"
};

// Compute every account's shared and (in admin role) real balance.
// Shared balance always comes through the shared_transactions_v view —
// hidden rows (shared_amount=0) are excluded automatically.
export async function getAccountsWithBalances(role: Role): Promise<AccountWithBalances[]> {
  const sb = serverClient();

  const { data: accounts, error: accErr } = await sb
    .from("accounts")
    .select("id, name, bank, type, real_starting_balance, shared_starting_balance")
    .eq("is_archived", false)
    .order("name");
  if (accErr) throw accErr;
  if (!accounts) return [];

  const shared = sharedClient();
  const { data: sharedRows, error: sErr } = await shared
    .from("shared_transactions_v")
    .select("account_id, amount");
  if (sErr) throw sErr;

  const sharedSum = new Map<string, number>();
  for (const r of sharedRows ?? []) {
    sharedSum.set(r.account_id, (sharedSum.get(r.account_id) ?? 0) + Number(r.amount));
  }

  const realSum = new Map<string, number>();
  // Only "admin" role sees real amounts; "household" and "public" see shared only
  if (role === "admin") {
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
      role === "admin"
        ? Number(a.real_starting_balance) + (realSum.get(a.id) ?? 0)
        : null
  }));
}
