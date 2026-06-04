import Link from "next/link";
import { ChevronLeft, Archive as ArchiveIcon } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { ArchiveClient, type ArchivedRow } from "./archive-client";
import { formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

// Archive of items TAKEN OUT of the portal. "Take out" = hide (shared_amount=0)
// — the real transaction is never deleted, just removed from the household view.
// Everything here can be restored (brought back) or permanently deleted.
export default async function ArchivePage() {
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
        "id, account_id, date, description_raw, description_clean, real_amount, is_fake, categories(slug)"
      )
      .eq("shared_amount", 0)
      .neq("status", "pending_review")
      .order("date", { ascending: false })
      .limit(500),
    sb.from("accounts").select("id, name")
  ]);

  const accountMap = new Map<string, string>();
  for (const a of accounts ?? []) accountMap.set(a.id, a.name);

  const out: ArchivedRow[] = (rows ?? []).map((r: {
    id: string;
    account_id: string;
    date: string;
    description_raw: string;
    description_clean: string | null;
    real_amount: number;
    is_fake: boolean;
    categories: { slug: string } | { slug: string }[] | null;
  }) => ({
    id: r.id,
    accountName: accountMap.get(r.account_id) ?? "—",
    date: r.date,
    description: r.description_clean ?? r.description_raw,
    amountReal: Number(r.real_amount),
    isFake: r.is_fake,
    categorySlug: Array.isArray(r.categories)
      ? r.categories[0]?.slug ?? "outros"
      : r.categories?.slug ?? "outros"
  }));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <header className="mb-5">
        <Link href="/admin" className="inline-flex items-center text-sm text-muted hover:text-fg gap-1">
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Arquivo</h1>
        <p className="text-xs text-muted">
          {out.length === 0
            ? "Nada removido — itens que você tirar do portal ficam guardados aqui."
            : `${formatInt(out.length)} ${out.length === 1 ? "item removido" : "itens removidos"} do portal · pode trazer de volta`}
        </p>
      </header>

      {out.length === 0 ? (
        <div className="rounded-2xl bg-card border border-dashed border-border p-8 text-center">
          <ArchiveIcon size={28} className="mx-auto text-muted mb-2" />
          <p className="text-sm text-muted">
            Quando você &quot;tirar&quot; uma despesa ou receita do portal, ela aparece
            aqui — nada é perdido, e você pode restaurar quando quiser.
          </p>
        </div>
      ) : (
        <ArchiveClient rows={out} />
      )}
    </div>
  );
}
