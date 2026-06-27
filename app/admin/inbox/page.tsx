import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { InboxClient, type InboxRow } from "./inbox-client";
import { formatInt } from "@/lib/format";
import { fromDb } from "@/lib/money";

export const dynamic = "force-dynamic";

// Review window: last 30 rolling days of non-transfer transactions that haven't
// been explicitly reviewed yet (auto_accepted or pending_review). The admin can
// recategorize, adjust the shared amount, or hide from the household portal.
export default async function InboxPage() {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const sb = serverClient();
  const [{ data: rows }, { data: accounts }] = await Promise.all([
    sb
      .from("transactions")
      .select(
        "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, is_transfer, categories(slug)"
      )
      .gte("date", fromDate)
      .eq("is_fake", false)
      .eq("is_transfer", false)
      .in("status", ["auto_accepted", "pending_review"])
      .order("date", { ascending: false })
      .limit(500),
    sb.from("accounts").select("id, name, bank").eq("is_archived", false).order("name")
  ]);

  const accountMap = new Map<string, string>();
  for (const a of accounts ?? []) accountMap.set(a.id, a.name);

  const out: InboxRow[] = (rows ?? []).map((r: {
    id: string;
    account_id: string;
    date: string;
    description_raw: string;
    description_clean: string | null;
    real_amount: number;
    shared_amount: number;
    is_transfer: boolean;
    categories: { slug: string } | { slug: string }[] | null;
  }) => ({
    id: r.id,
    accountName: accountMap.get(r.account_id) ?? "—",
    date: r.date,
    description: r.description_clean ?? r.description_raw,
    amountReal: fromDb(Number(r.real_amount)),
    isTransfer: r.is_transfer,
    categorySlug: Array.isArray(r.categories)
      ? r.categories[0]?.slug ?? "outros"
      : r.categories?.slug ?? "outros"
  }));

  const accountsList = (accounts ?? []).map((a) => ({ id: a.id, name: a.name, bank: a.bank }));

  return (
    <>
    <PageHeader
      title="Caixa de entrada"
      crumbs={[{ href: "/admin", label: "Admin" }]}
      right={out.length > 0 ? <span className="badge-hidden">{formatInt(out.length)}</span> : undefined}
    />
    <div className="px-4 pt-5 max-w-2xl mx-auto pb-28">
      <p className="text-sm text-on-surface-variant mb-5">
        {out.length === 0
          ? "Nenhum movimento novo nos últimos 30 dias."
          : `${formatInt(out.length)} ${out.length === 1 ? "movimento nos últimos 30 dias" : "movimentos nos últimos 30 dias"}`}
      </p>

      <InboxClient rows={out} accounts={accountsList} />
    </div>
  </>
  );
}
