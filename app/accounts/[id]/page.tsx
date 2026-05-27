import Link from "next/link";
import { notFound } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { TransactionRow } from "@/components/transaction-row";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = await getRole();
  const sb = serverClient();

  const { data: account } = await sb
    .from("accounts")
    .select("id, name, bank, type, real_starting_balance, shared_starting_balance, cc_issuer")
    .eq("id", id)
    .single();
  if (!account) notFound();

  let rows: Array<{
    id: string;
    date: string;
    description: string;
    amountShared: number;
    amountReal: number | null;
    isFake: boolean;
    isTransfer: boolean;
    categorySlug: string | null;
  }> = [];
  let sharedBalance = Number(account.shared_starting_balance);
  let realBalance: number | null = role === "admin" ? Number(account.real_starting_balance) : null;

  if (role !== "admin") {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("id, date, description, amount, is_transfer")
      .eq("account_id", id)
      .order("date", { ascending: false })
      .limit(200);
    for (const r of data ?? []) sharedBalance += Number(r.amount);
    rows = (data ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description ?? "",
      amountShared: Number(r.amount),
      amountReal: null,
      isFake: false,
      isTransfer: r.is_transfer,
      categorySlug: null
    }));
  } else {
    const { data } = await sb
      .from("transactions")
      .select(
        "id, date, description_raw, description_clean, real_amount, shared_amount, is_fake, is_transfer"
      )
      .eq("account_id", id)
      .order("date", { ascending: false })
      .limit(200);
    for (const r of data ?? []) {
      sharedBalance += Number(r.shared_amount);
      if (realBalance !== null) realBalance += Number(r.real_amount);
    }
    rows = (data ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description_clean ?? r.description_raw,
      amountShared: Number(r.shared_amount),
      amountReal: Number(r.real_amount),
      isFake: r.is_fake,
      isTransfer: r.is_transfer,
      categorySlug: null
    }));
  }

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="mb-6">
        <Link href="/" className="text-sm text-muted">← voltar</Link>
        <h1 className="text-2xl font-semibold mt-2">{account.name}</h1>
        <p className="text-xs text-muted">{account.bank} · {account.type}</p>
      </header>

      <section className="mb-6 p-4 rounded-xl bg-card border border-border">
        <p className="text-xs uppercase tracking-wider text-muted">Saldo</p>
        <p className="text-3xl font-semibold tabular-nums">{formatBRL(sharedBalance)}</p>
        {role === "admin" && realBalance !== null && realBalance !== sharedBalance && (
          <p className="mt-1 text-xs text-muted tabular-nums">
            real {formatBRL(realBalance)} · Δ {formatBRL(realBalance - sharedBalance)}
          </p>
        )}
      </section>

      {role === "admin" && (
        <div className="mb-4">
          <Link
            href={`/admin/import?account=${id}`}
            className="inline-block text-sm px-4 py-2 rounded-lg bg-card border border-border"
          >
            Importar extrato
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted">Nenhum movimento.</p>}
        {rows.map((r) => (
          <TransactionRow key={r.id} {...r} role={role} />
        ))}
      </div>
    </div>
  );
}
