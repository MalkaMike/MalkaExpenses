import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { InboxClient, type InboxRow } from "./inbox-client";
import { formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

// The admin acceptance gate. Everything synced from Open Finance lands here
// first (real, but invisible to the household). The admin decides per row:
// Accept (show), Hide (keep private), Adjust (show a different amount), or
// recategorize — and can add manual entries that appear in the portal.
export default async function InboxPage() {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }

  const sb = serverClient();
  const [{ data: rows }, { data: accounts }] = await Promise.all([
    sb
      .from("transactions")
      .select(
        "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, is_transfer, categories(slug)"
      )
      .eq("status", "pending_review")
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
    amountReal: Number(r.real_amount),
    isTransfer: r.is_transfer,
    categorySlug: Array.isArray(r.categories)
      ? r.categories[0]?.slug ?? "outros"
      : r.categories?.slug ?? "outros"
  }));

  const accountsList = (accounts ?? []).map((a) => ({ id: a.id, name: a.name, bank: a.bank }));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <header className="mb-5">
        <Link href="/admin" className="inline-flex items-center text-sm text-muted hover:text-fg gap-1">
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Caixa de entrada</h1>
        <p className="text-xs text-muted">
          {out.length === 0
            ? "Nada para revisar — tudo já decidido."
            : `${formatInt(out.length)} ${out.length === 1 ? "movimento aguardando" : "movimentos aguardando"} sua decisão`}
        </p>
      </header>

      <InboxClient rows={out} accounts={accountsList} />
    </div>
  );
}
