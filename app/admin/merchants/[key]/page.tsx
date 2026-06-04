import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, rawDescriptionsForKey, preloadClusters } from "@/lib/merchants/clusters";
import { formatBRL, formatDate, formatInt } from "@/lib/format";
import { MerchantDetailClient } from "./merchant-detail-client";

export const dynamic = "force-dynamic";

export default async function MerchantDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ direction?: string }>;
}) {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }

  const { key: rawKey } = await params;
  const sp = await searchParams;
  const direction = sp.direction === "in" ? "in" : sp.direction === "all" ? "all" : "out";
  const backLabel = direction === "in" ? "pagadores" : direction === "all" ? "tudo" : "comerciantes";
  const key = decodeURIComponent(rawKey);

  const sb = serverClient();

  // Preload cluster mapping (DB → JSON fallback)
  await preloadClusters();

  // Find all raw descriptions that map to this canonical key
  const rawDescs = await rawDescriptionsForKey(key);

  // Pull transactions: either by description match (if we have the cluster map)
  // or by exact description if the key was a fallback
  let txs: Array<{
    id: string;
    date: string;
    description_raw: string;
    description_clean: string | null;
    real_amount: number;
    shared_amount: number;
    category_id: string | null;
    account_id: string;
    source: string;
    ai_reasoning: string | null;
  }> = [];

  // Pull transactions matching ANY raw description in the cluster.
  // Two-level pagination because Postgres .in() can be large but inefficient,
  // and Supabase caps result sets at 1000 rows per request.
  //
  // - Outer: chunk rawDescs in slices of 200 (PG planner stays sane).
  // - Inner: paginate each chunk with .range(); stable .order("id") + date desc
  //   ensures no row is skipped or duplicated under concurrent inserts.
  if (rawDescs.length > 0) {
    const DESC_CHUNK = 200;
    for (let i = 0; i < rawDescs.length; i += DESC_CHUNK) {
      const slice = rawDescs.slice(i, i + DESC_CHUNK);
      let off = 0;
      while (true) {
        const { data, error } = await sb
          .from("transactions")
          .select(
            "id, date, description_raw, description_clean, real_amount, shared_amount, category_id, account_id, source, ai_reasoning"
          )
          .in("description_raw", slice)
          .order("date", { ascending: false })
          .order("id", { ascending: true })  // tie-breaker → stable pagination
          .range(off, off + 999);
        if (error) {
          // Fail visibly — partial data on this page would mislead the admin.
          throw new Error(`Failed to load transactions: ${error.message}`);
        }
        if (!data || !data.length) break;
        txs.push(...(data as typeof txs));
        if (data.length < 1000) break;
        off += 1000;
      }
    }
  }

  // Categories + accounts for display
  const [{ data: cats }, { data: accounts }] = await Promise.all([
    sb.from("categories").select("id, slug, name").order("name"),
    sb.from("accounts").select("id, name, bank").eq("is_archived", false)
  ]);
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);
  const accountNameById = new Map<string, string>();
  for (const a of accounts ?? []) accountNameById.set(a.id as string, a.name as string);

  // Stats
  const totalAbs = txs.reduce((s, t) => s + Math.abs(Number(t.real_amount)), 0);
  const totalSigned = txs.reduce((s, t) => s + Number(t.real_amount), 0);
  const oldest = txs.length > 0 ? txs[txs.length - 1].date : null;
  const newest = txs.length > 0 ? txs[0].date : null;

  // Current category (most common)
  const catCount = new Map<string, number>();
  for (const t of txs) {
    const k = t.category_id ?? "__none__";
    catCount.set(k, (catCount.get(k) ?? 0) + 1);
  }
  const topCatEntry = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const currentCategoryId =
    topCatEntry && topCatEntry[0] !== "__none__" ? topCatEntry[0] : null;

  // Determine name from any transaction
  const displayName =
    txs.length > 0 ? clusterFor(txs[0].description_raw).name : key;

  const rows = txs.map((t) => ({
    id: t.id,
    date: t.date,
    description: t.description_clean ?? t.description_raw,
    descriptionRaw: t.description_raw,
    amount: Number(t.real_amount),
    sharedAmount: Number(t.shared_amount),
    accountName: accountNameById.get(t.account_id) ?? "—",
    categoryName: t.category_id ? catNameById.get(t.category_id) ?? "—" : "—",
    source: t.source,
    aiReasoning: t.ai_reasoning
  }));

  // Aggregate the current shared state across the cluster — used to seed the
  // "Compartilhar com Ayelet" panel default selection.
  const totalShared = txs.reduce((s, t) => s + Number(t.shared_amount), 0);
  const allHidden = txs.every((t) => Number(t.shared_amount) === 0);
  const allShown = txs.every(
    (t) => Number(t.shared_amount) === Number(t.real_amount)
  );
  const shareMode: "hide" | "show" | "mixed" = allHidden
    ? "hide"
    : allShown
      ? "show"
      : "mixed";

  const categories = (cats ?? []).map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    name: c.name as string
  }));

  return (
    <div className="px-4 pt-6 max-w-3xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href={`/admin/merchants?direction=${direction}`}
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold mt-2 truncate">{displayName}</h1>
        <p className="text-xs text-muted mt-1">
          {formatInt(txs.length)} {txs.length === 1 ? "transação" : "transações"} ·{" "}
          {oldest && newest ? `${formatDate(oldest)} → ${formatDate(newest)}` : "—"}
        </p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-3 mb-5">
        <div className="p-3 rounded-xl bg-card border border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted">Total absoluto</p>
          <p className="text-lg font-semibold tabular-nums">{formatBRL(totalAbs)}</p>
        </div>
        <div className="p-3 rounded-xl bg-card border border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted">Líquido</p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              totalSigned < 0 ? "text-danger" : "text-accent"
            }`}
          >
            {formatBRL(totalSigned)}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-card border border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted">Variações</p>
          <p className="text-lg font-semibold tabular-nums">
            {formatInt(new Set(txs.map((t) => t.description_raw)).size)}
          </p>
        </div>
      </section>

      <MerchantDetailClient
        canonicalKey={key}
        currentCategoryId={currentCategoryId}
        categories={categories}
        rows={rows}
        currentShareMode={shareMode}
        currentSharedTotal={totalShared}
        currentName={displayName}
      />
    </div>
  );
}
