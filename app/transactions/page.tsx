import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { getLang } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/translations";
import { TransactionsClient } from "./transactions-client";
import { formatInt } from "@/lib/format";
import { fromDb } from "@/lib/money";

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
  isSuspeito: boolean;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const initialAccId = sp.account ?? "";
  const initialCat = sp.cat ?? "";

  const role = await getRole();
  const lang = await getLang();
  const sb = serverClient();

  // Accounts, transaction rows, and the (constant) suspeito tag id are
  // mutually independent — one parallel stage instead of a 3-step waterfall.
  const accountsQ = sb.from("accounts").select("id, name").eq("is_archived", false).order("name");
  const tagQ = sb.from("reimbursement_tags").select("id").eq("slug", "suspeito").maybeSingle();

  let accounts: Array<{ id: string; name: string }> | null = null;
  let tagId: string | null = null;
  let rows: Row[] = [];

  if (role !== "admin") {
    const sh = sharedClient();
    const [accountsRes, tagRes, listRes] = await Promise.all([
      accountsQ,
      tagQ,
      sh
        .from("shared_transactions_v")
        .select("id, account_id, date, description, amount, category_slug, is_transfer")
        .order("date", { ascending: false })
        .limit(500)
    ]);
    accounts = accountsRes.data;
    tagId = (tagRes.data?.id as string | undefined) ?? null;
    const data = listRes.data;
    rows = (data ?? []).map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      description: r.description ?? "",
      amountShared: fromDb(Number(r.amount)),
      amountReal: null,
      categorySlug: r.category_slug,
      isFake: false,
      isTransfer: r.is_transfer,
      isSuspeito: false
    }));
  } else {
    const [accountsRes, tagRes, listRes] = await Promise.all([
      accountsQ,
      tagQ,
      sb
        .from("transactions")
        .select(
          "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, category_id, is_fake, is_transfer, categories(slug)"
        )
        .eq("is_fake", false)
        .order("date", { ascending: false })
        .limit(500)
    ]);
    accounts = accountsRes.data;
    tagId = (tagRes.data?.id as string | undefined) ?? null;
    const data = listRes.data;
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
      amountShared: fromDb(Number(r.shared_amount)),
      amountReal: fromDb(Number(r.real_amount)),
      categorySlug: Array.isArray(r.categories)
        ? r.categories[0]?.slug ?? null
        : r.categories?.slug ?? null,
      isFake: r.is_fake,
      isTransfer: r.is_transfer,
      isSuspeito: false
    }));
  }

  // "Suspeito" tag membership for the rows already fetched above. Scoped to
  // ids that already passed the security boundary (shared_transactions_v for
  // non-admin, is_fake=false for admin) — this only reads tag membership,
  // never amounts or hidden rows, so using the service-role client here for
  // a household/health viewer doesn't widen what they can see.
  if (rows.length > 0 && tagId) {
    const ids = rows.map((r) => r.id);
    const suspeitoIds = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: tagged } = await sb
        .from("transaction_reimbursements")
        .select("transaction_id")
        .eq("tag_id", tagId)
        .in("transaction_id", ids.slice(i, i + 500));
      for (const t of tagged ?? []) suspeitoIds.add(t.transaction_id as string);
    }
    for (const r of rows) r.isSuspeito = suspeitoIds.has(r.id);
  }

  const accountsList = (accounts ?? []).map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold">{t("tx.title", lang)}</h1>
        <span className="text-xs text-muted tabular-nums">{formatInt(rows.length)}</span>
      </header>
      <TransactionsClient
        rows={rows}
        accounts={accountsList}
        role={role}
        initialAccId={initialAccId}
        initialCat={initialCat}
      />
    </div>
  );
}
