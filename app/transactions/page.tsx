import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { TransactionRow } from "@/components/transaction-row";

export const dynamic = "force-dynamic";

type SharedRow = {
  id: string;
  account_id: string;
  date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
  is_transfer: boolean;
};

type AdminRow = {
  id: string;
  account_id: string;
  date: string;
  description_raw: string;
  description_clean: string | null;
  real_amount: number;
  shared_amount: number;
  category_id: string | null;
  is_fake: boolean;
  is_transfer: boolean;
};

export default async function TransactionsPage() {
  const role = await getRole();

  let rows: Array<{
    id: string;
    date: string;
    description: string;
    amountShared: number;
    amountReal: number | null;
    categorySlug: string | null;
    isFake: boolean;
    isTransfer: boolean;
  }> = [];

  if (role === "public") {
    const sb = sharedClient();
    const { data } = await sb
      .from("shared_transactions_v")
      .select("id, account_id, date, description, amount, category_id, is_transfer")
      .order("date", { ascending: false })
      .limit(200);
    rows = ((data ?? []) as SharedRow[]).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description ?? "",
      amountShared: Number(r.amount),
      amountReal: null,
      categorySlug: null,
      isFake: false,
      isTransfer: r.is_transfer
    }));
  } else {
    const sb = serverClient();
    const { data } = await sb
      .from("transactions")
      .select(
        "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, category_id, is_fake, is_transfer"
      )
      .order("date", { ascending: false })
      .limit(200);
    rows = ((data ?? []) as AdminRow[]).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description_clean ?? r.description_raw,
      amountShared: Number(r.shared_amount),
      amountReal: Number(r.real_amount),
      categorySlug: null,
      isFake: r.is_fake,
      isTransfer: r.is_transfer
    }));
  }

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Movimentos</h1>
        <span className="text-xs text-muted">{rows.length}</span>
      </header>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted">Nada por enquanto.</p>}
        {rows.map((r) => (
          <TransactionRow key={r.id} {...r} role={role} />
        ))}
      </div>
    </div>
  );
}
