import { Search } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { TransactionsClient } from "./transactions-client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amountShared: number;
  amountReal: number | null;
  categorySlug: string | null;
  isFake: boolean;
  isTransfer: boolean;
};

export default async function TransactionsPage() {
  const role = await getRole();
  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name")
    .eq("is_archived", false)
    .order("name");

  let rows: Row[] = [];

  if (role !== "admin") {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("id, account_id, date, description, amount, category_slug, is_transfer")
      .order("date", { ascending: false })
      .limit(500);
    rows = (data ?? []).map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description ?? "",
      amountShared: Number(r.amount),
      amountReal: null,
      categorySlug: r.category_slug,
      isFake: false,
      isTransfer: r.is_transfer
    }));
  } else {
    const { data } = await sb
      .from("transactions")
      .select(
        "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, category_id, is_fake, is_transfer, categories(slug)"
      )
      .order("date", { ascending: false })
      .limit(500);
    rows = (data ?? []).map((r: {
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
      categories: { slug: string } | { slug: string }[] | null;
    }) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description_clean ?? r.description_raw,
      amountShared: Number(r.shared_amount),
      amountReal: Number(r.real_amount),
      categorySlug: Array.isArray(r.categories)
        ? r.categories[0]?.slug ?? null
        : r.categories?.slug ?? null,
      isFake: r.is_fake,
      isTransfer: r.is_transfer
    }));
  }

  const accountsList = (accounts ?? []).map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold">Movimentos</h1>
        <span className="text-xs text-muted">{rows.length}</span>
      </header>
      <TransactionsClient rows={rows} accounts={accountsList} role={role} />
    </div>
  );
}
