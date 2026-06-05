import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, rawDescriptionsForKeyDirect, preloadClusters } from "@/lib/merchants/clusters";
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

  // Always query DB directly — immune to stale per-instance in-memory cache.
  // This ensures post-merge renders see the updated mapping immediately.
  const rawDescs = await rawDescriptionsForKeyDirect(key);

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
    gmail_searched_at: string | null;
    gmail_match_count: number;
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
            "id, date, description_raw, description_clean, real_amount, shared_amount, category_id, account_id, source, ai_reasoning, gmail_searched_at, gmail_match_count"
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

  // Unique original descriptions — shown as "origens" on the page so user
  // can see all constituent raw names after a merge (e.g. "St Paul's" + "Fundação Anglo").
  const uniqueRawDescs = [...new Set(txs.map((t) => t.description_raw))].sort();

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
    aiReasoning: t.ai_reasoning,
    gmailSearched: t.gmail_searched_at !== null,
    gmailMatchCount: Number(t.gmail_match_count) || 0
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

  // Reimbursement tags currently applied across these transactions
  const txIds = txs.map((t) => t.id);
  type ReimbAgg = { tag_id: string; count: number };
  const tagCounts = new Map<string, number>();
  if (txIds.length > 0) {
    const { data: reimbRows } = await sb
      .from("transaction_reimbursements")
      .select("tag_id, transaction_id")
      .in("transaction_id", txIds);
    for (const r of reimbRows ?? []) {
      const k = r.tag_id as string;
      tagCounts.set(k, (tagCounts.get(k) ?? 0) + 1);
    }
  }
  const { data: tags } = await sb
    .from("reimbursement_tags")
    .select("id, slug, name, color, icon")
    .order("slug");
  const tagList = (tags ?? []).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    color: t.color as string,
    icon: t.icon as string,
    appliedCount: tagCounts.get(t.id as string) ?? 0
  }));

  // Load all distinct (canonical_key, canonical_name) pairs for the rename
  // combobox autocomplete — used to either RENAME (free text) or MERGE
  // (pick an existing merchant). 2378 entries × ~50 chars ≈ 120KB, fine.
  type ClusterOption = { key: string; name: string };
  const seenKeys = new Set<string>();
  const allClusters: ClusterOption[] = [];
  let cOff = 0;
  while (true) {
    const { data } = await sb
      .from("merchant_clusters")
      .select("canonical_key, canonical_name")
      .order("canonical_name", { ascending: true })
      .range(cOff, cOff + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      const k = r.canonical_key as string;
      if (k === key) continue; // exclude current cluster
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      allClusters.push({ key: k, name: r.canonical_name as string });
    }
    if (data.length < 1000) break;
    cOff += 1000;
  }

  const categories = (cats ?? []).map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    name: c.name as string
  }));

  return (
    <>
    <PageHeader
      title={displayName}
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: `/admin/merchants?direction=${direction}`, label: direction === "in" ? "Pagadores" : "Comerciantes" }
      ]}
    />
    <div className="px-4 pt-5 max-w-3xl mx-auto pb-24">
      {/* Transaction date range */}
      <p className="text-xs text-on-surface-variant mb-5">
        {formatInt(txs.length)} {txs.length === 1 ? "transação" : "transações"}
        {oldest && newest ? ` · ${formatDate(oldest)} → ${formatDate(newest)}` : ""}
      </p>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Total absoluto</p>
          <p className="text-lg font-semibold tabular-nums text-on-surface">{formatBRL(totalAbs)}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Líquido</p>
          <p className={`text-lg font-semibold tabular-nums ${totalSigned < 0 ? "text-on-tertiary-container" : "text-secondary"}`}>
            {formatBRL(totalSigned)}
          </p>
        </div>
        <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Variações</p>
          <p className="text-lg font-semibold tabular-nums text-on-surface">
            {formatInt(uniqueRawDescs.length)}
          </p>
        </div>
      </section>

      {/* Origens — shows all constituent raw descriptions after merges */}
      {uniqueRawDescs.length > 0 && (
        <section className="mb-5 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant soft-ambient-shadow">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2.5">
            Nomes originais agrupados ({formatInt(uniqueRawDescs.length)})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {uniqueRawDescs.map((d) => (
              <span
                key={d}
                className="text-xs px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant font-medium"
              >
                {d}
              </span>
            ))}
          </div>
        </section>
      )}

      <MerchantDetailClient
        canonicalKey={key}
        currentCategoryId={currentCategoryId}
        categories={categories}
        rows={rows}
        currentShareMode={shareMode}
        currentSharedTotal={totalShared}
        currentName={displayName}
        tags={tagList}
        allClusters={allClusters}
      />
    </div>
  </>
  );
}
