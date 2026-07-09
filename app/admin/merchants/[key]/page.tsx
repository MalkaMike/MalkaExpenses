import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, rawDescriptionsForKeyDirect, preloadClusters } from "@/lib/merchants/clusters";
import { formatBRL, formatDate, formatInt } from "@/lib/format";
import { fromDb } from "@/lib/money";
import { MerchantDetailClient } from "./merchant-detail-client";

export const dynamic = "force-dynamic";

export default async function MerchantDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ direction?: string }>;
}) {
  const role = await getRole();
  if (role !== "admin" && role !== "health") {
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

  // Preload cluster mapping (DB → JSON fallback) and the direct-DB
  // description lookup are independent → parallel. (Direct query = immune to
  // stale per-instance cache; post-merge renders see the updated mapping.)
  const [, rawDescs] = await Promise.all([preloadClusters(), rawDescriptionsForKeyDirect(key)]);

  type TxRow = {
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
    status: string;
  };

  // Pull transactions matching ANY raw description in the cluster.
  // Two-level pagination because Postgres .in() can be large but inefficient,
  // and Supabase caps result sets at 1000 rows per request.
  //
  // - Outer: chunk rawDescs in slices of 200 (PG planner stays sane).
  // - Inner: paginate each chunk with .range(); stable .order("id") + date desc
  //   ensures no row is skipped or duplicated under concurrent inserts.
  async function loadTxs(): Promise<TxRow[]> {
    const out: TxRow[] = [];
    if (rawDescs.length === 0) return out;
    const DESC_CHUNK = 200;
    for (let i = 0; i < rawDescs.length; i += DESC_CHUNK) {
      const slice = rawDescs.slice(i, i + DESC_CHUNK);
      let off = 0;
      while (true) {
        const { data, error } = await sb
          .from("transactions")
          .select(
            "id, date, description_raw, description_clean, real_amount, shared_amount, category_id, account_id, source, ai_reasoning, gmail_searched_at, gmail_match_count, status"
          )
          .in("description_raw", slice)
          .eq("is_fake", false)
          .order("date", { ascending: false })
          .order("id", { ascending: true })  // tie-breaker → stable pagination
          .range(off, off + 999);
        if (error) {
          // Fail visibly — partial data on this page would mislead the admin.
          throw new Error(`Failed to load transactions: ${error.message}`);
        }
        if (!data || !data.length) break;
        out.push(...(data as TxRow[]));
        if (data.length < 1000) break;
        off += 1000;
      }
    }
    return out;
  }

  // ONE parallel stage for everything that doesn't need the tx list —
  // previously these ran one-after-another (~8-12 sequential round-trips
  // per ficha open; the list page got this treatment in c3d09aa, the
  // detail page didn't).
  const [txs, catsRes, accountsRes, researchRes, tagsRes, mergeRowsRes] = await Promise.all([
    loadTxs(),
    sb.from("categories").select("id, slug, name").order("name"),
    sb.from("accounts").select("id, name, bank").eq("is_archived", false),
    role === "admin"
      ? sb.from("merchant_research").select("*").eq("canonical_key", key).maybeSingle()
      : Promise.resolve({ data: null }),
    role === "admin"
      ? sb.from("reimbursement_tags").select("id, slug, name, color, icon").order("slug")
      : Promise.resolve({ data: null }),
    role === "admin"
      ? sb
          .from("admin_modifications")
          .select("id, before_value, created_at")
          .eq("action", "merge")
          .eq("target_id", key)
          .is("reverted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null })
  ]);
  const cats = catsRes.data;
  const accounts = accountsRes.data;
  const researchRow = researchRes.data;
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);
  const accountNameById = new Map<string, string>();
  for (const a of accounts ?? []) accountNameById.set(a.id as string, a.name as string);

  // Stats
  const totalAbs = txs.reduce((s, t) => s + Math.abs(fromDb(Number(t.real_amount))), 0);
  const totalSigned = txs.reduce((s, t) => s + fromDb(Number(t.real_amount)), 0);
  const oldest = txs.length > 0 ? txs[txs.length - 1].date : null;
  const newest = txs.length > 0 ? txs[0].date : null;

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
    amount: fromDb(Number(t.real_amount)),
    sharedAmount: fromDb(Number(t.shared_amount)),
    accountName: accountNameById.get(t.account_id) ?? "—",
    categoryName: t.category_id ? catNameById.get(t.category_id) ?? "—" : "—",
    source: t.source,
    aiReasoning: t.ai_reasoning,
    gmailSearched: t.gmail_searched_at !== null,
    gmailMatchCount: Number(t.gmail_match_count) || 0
  }));

  // Pending-review count — drives the "Aprovar todas" bulk-approve button.
  const pendingCount = txs.filter((t) => t.status === "pending_review").length;
  const categoryList = (cats ?? []).map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    name: c.name as string
  }));
  // Pre-select the category in the picker only if every tx already agrees.
  const distinctCatIds = new Set(txs.map((t) => t.category_id).filter(Boolean));
  const uniformCategoryId = distinctCatIds.size === 1 ? [...distinctCatIds][0] as string : null;

  // Aggregate the current shared state across the cluster — used to seed the
  // "Compartilhar com Ayelet" panel default selection.
  const totalShared = txs.reduce((s, t) => s + fromDb(Number(t.shared_amount)), 0);
  const allHidden = txs.every((t) => Number(t.shared_amount) === 0);
  const allShown = txs.every(
    (t) => Number(t.shared_amount) === Number(t.real_amount)
  );
  const shareMode: "hide" | "show" | "mixed" = allHidden
    ? "hide"
    : allShown
      ? "show"
      : "mixed";

  // Reimbursement tags — admin only (health role sees a read-only view without tag controls)
  const txIds = role === "admin" ? txs.map((t) => t.id) : [];
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
  const tagList: { id: string; slug: string; name: string; color: string; icon: string; appliedCount: number }[] = [];
  for (const t of tagsRes.data ?? []) {
    tagList.push({
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      color: t.color as string,
      icon: t.icon as string,
      appliedCount: tagCounts.get(t.id as string) ?? 0
    });
  }

  // Merge history — past merges where this cluster was the target (absorbed others)
  const mergeHistory: { id: string; sourceName: string; createdAt: string; hasDescriptions: boolean }[] = [];
  for (const m of mergeRowsRes.data ?? []) {
    const bv = m.before_value as { source_name?: string; descriptions?: string[] } | null;
    mergeHistory.push({
      id: m.id as string,
      sourceName: bv?.source_name ?? "?",
      createdAt: m.created_at as string,
      hasDescriptions: Array.isArray(bv?.descriptions) && (bv?.descriptions?.length ?? 0) > 0
    });
  }

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
        rows={rows}
        currentShareMode={shareMode}
        currentSharedTotal={totalShared}
        currentName={displayName}
        tags={tagList}
        mergeHistory={mergeHistory}
        role={role as "admin" | "health"}
        pendingCount={pendingCount}
        categories={categoryList}
        uniformCategoryId={uniformCategoryId}
        research={
          researchRow
            ? {
                verdict: researchRow.verdict as "legitimo" | "suspeito" | "desconhecido" | "pessoa_fisica",
                summary: researchRow.summary as string,
                whatDoes: researchRow.what_does as string | null,
                website: researchRow.website as string | null,
                segment: researchRow.segment as string | null,
                reclameAqui: researchRow.reclame_aqui as string | null,
                suggestedCategorySlug: researchRow.suggested_category_slug as string | null,
                cnpj: researchRow.cnpj as string | null,
                cnpjData: researchRow.cnpj_data as Record<string, string | null> | null,
                sources: (researchRow.sources as { title: string; url: string }[]) ?? [],
                updatedAt: researchRow.updated_at as string
              }
            : null
        }
      />
    </div>
  </>
  );
}
