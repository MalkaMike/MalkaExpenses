import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Upload } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { TransactionRow } from "@/components/transaction-row";
import { formatBRL, monthLabel } from "@/lib/format";
import { AccountEditPanel } from "./account-edit-panel";

export const dynamic = "force-dynamic";

const BANK_LABEL: Record<string, string> = {
  itau: "Itaú",
  bradesco: "Bradesco",
  santander: "Santander",
  nubank: "Nubank",
  inter: "Inter",
  btg: "BTG",
  c6: "C6"
};

const TYPE_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito"
};

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

  type RowOut = {
    id: string;
    date: string;
    description: string;
    amountShared: number;
    amountReal: number | null;
    isFake: boolean;
    isTransfer: boolean;
    categorySlug: string | null;
  };

  let rows: RowOut[] = [];
  let sharedBalance = Number(account.shared_starting_balance);
  let realBalance: number | null = role === "admin" ? Number(account.real_starting_balance) : null;

  if (role !== "admin") {
    const sh = sharedClient();
    const { data } = await sh
      .from("shared_transactions_v")
      .select("id, date, description, amount, category_slug, is_transfer")
      .eq("account_id", id)
      .order("date", { ascending: false })
      .limit(300);
    for (const r of data ?? []) sharedBalance += Number(r.amount);
    rows = (data ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description ?? "",
      amountShared: Number(r.amount),
      amountReal: null,
      isFake: false,
      isTransfer: r.is_transfer,
      categorySlug: r.category_slug
    }));
  } else {
    const { data } = await sb
      .from("transactions")
      .select(
        "id, date, description_raw, description_clean, real_amount, shared_amount, is_fake, is_transfer, categories(slug)"
      )
      .eq("account_id", id)
      .order("date", { ascending: false })
      .limit(300);
    for (const r of data ?? []) {
      sharedBalance += Number(r.shared_amount);
      if (realBalance !== null) realBalance += Number(r.real_amount);
    }
    rows = (data ?? []).map((r: {
      id: string;
      date: string;
      description_raw: string;
      description_clean: string | null;
      real_amount: number;
      shared_amount: number;
      is_fake: boolean;
      is_transfer: boolean;
      categories: { slug: string } | { slug: string }[] | null;
    }) => ({
      id: r.id,
      date: r.date,
      description: r.description_clean ?? r.description_raw,
      amountShared: Number(r.shared_amount),
      amountReal: Number(r.real_amount),
      isFake: r.is_fake,
      isTransfer: r.is_transfer,
      categorySlug: Array.isArray(r.categories)
        ? r.categories[0]?.slug ?? null
        : r.categories?.slug ?? null
    }));
  }

  // Monthly inflow/outflow (last 6 months)
  const monthAgg = new Map<string, { in: number; out: number }>();
  for (const r of rows) {
    if (r.isTransfer) continue;
    const m = r.date.slice(0, 7);
    const cur = monthAgg.get(m) ?? { in: 0, out: 0 };
    if (r.amountShared > 0) cur.in += r.amountShared;
    else cur.out += -r.amountShared;
    monthAgg.set(m, cur);
  }
  const monthsBars = Array.from(monthAgg.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .reverse();

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="mb-5">
        <Link href="/" className="inline-flex items-center text-sm text-muted hover:text-fg gap-1">
          <ChevronLeft size={14} /> voltar
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            <p className="text-xs text-muted">
              {BANK_LABEL[account.bank] ?? account.bank} · {TYPE_LABEL[account.type] ?? account.type}
            </p>
          </div>
          {role === "admin" && (
            <AccountEditPanel
              account={{
                id: account.id,
                name: account.name,
                bank: account.bank,
                type: account.type,
                real_starting_balance: Number(account.real_starting_balance),
                shared_starting_balance: Number(account.shared_starting_balance),
                cc_issuer: account.cc_issuer ?? null
              }}
            />
          )}
        </div>
      </header>

      <section className="rounded-2xl bg-gradient-to-br from-card to-card/40 border border-border p-5 mb-5">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Saldo</p>
        <p className="text-4xl font-semibold tabular-nums">{formatBRL(sharedBalance)}</p>
        {role === "admin" && realBalance !== null && realBalance !== sharedBalance && (
          <p className="mt-1.5 text-xs text-muted tabular-nums">
            real {formatBRL(realBalance)} · Δ {formatBRL(realBalance - sharedBalance)}
          </p>
        )}
        <Link
          href={`/import?account=${id}`}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/30 text-xs hover:bg-accent/20"
        >
          <Upload size={12} /> importar extrato
        </Link>
      </section>

      {monthsBars.length >= 2 && (
        <section className="rounded-2xl bg-card border border-border p-5 mb-5">
          <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Últimos meses</h2>
          <div className="space-y-2.5">
            {monthsBars.map(([m, v]) => {
              const total = v.in + v.out;
              const inPct = total > 0 ? (v.in / total) * 100 : 0;
              return (
                <div key={m}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="capitalize">{monthLabel(m)}</span>
                    <span className="tabular-nums">
                      <span className="text-accent">+{formatBRL(v.in)}</span>
                      {" "}
                      <span className="text-danger">-{formatBRL(v.out)}</span>
                    </span>
                  </div>
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-bg">
                    <div className="bg-accent" style={{ width: `${inPct}%` }} />
                    <div className="bg-danger" style={{ width: `${100 - inPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-xs uppercase tracking-wider text-muted">Movimentos</h2>
        {rows.length > 0 && (
          <span className="text-[11px] text-muted tabular-nums">
            {Math.min(rows.length, 100)} de {rows.length}
            {rows.length === 300 ? "+" : ""}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted text-center py-8">Nenhum movimento.</p>}
        {rows.slice(0, 100).map((r) => (
          <TransactionRow key={r.id} {...r} role={role} />
        ))}
        {rows.length > 100 && (
          <p className="text-center text-xs text-muted py-3 border border-dashed border-border rounded-xl">
            {rows.length - 100} movimentos mais antigos não exibidos.{" "}
            <a href={`/transactions?account=${id}`} className="text-accent underline">
              Ver todos em Movimentos
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
