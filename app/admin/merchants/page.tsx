import Link from "next/link";
import { AlertCircle, SlidersHorizontal } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters, invalidateCache } from "@/lib/merchants/clusters";
import { formatBRL, formatInt } from "@/lib/format";
import { fromDb } from "@/lib/money";
import { MerchantsClient, type ClientMerchantGroup, type TagDef } from "./merchants-client";

export const dynamic = "force-dynamic";

type TxRow = {
  id: string;
  description_raw: string;
  real_amount: number;
  shared_amount: number;
  category_id: string | null;
  date: string;
  source: string;
  is_transfer: boolean;
};

type MerchantGroup = {
  key: string;
  name: string;
  txCount: number;
  totalAbs: number;
  totalSigned: number;
  categoryIds: Map<string, number>;
  uniqueDescriptions: Set<string>;
  hiddenCount: number;
  shownCount: number;
  adjustedCount: number;
};

type Direction = "out" | "in" | "all";

const COPY: Record<Direction, { title: string; subtitle: string; emptyLabel: string; rowsLabel: string }> = {
  out: { title: "Comerciantes",       subtitle: "para onde sai o dinheiro",         emptyLabel: "Nenhuma despesa", rowsLabel: "comerciantes" },
  in:  { title: "Pagadores",          subtitle: "de onde vem o dinheiro",           emptyLabel: "Nenhuma receita", rowsLabel: "pagadores"    },
  all: { title: "Todas as entidades", subtitle: "despesas + receitas consolidadas", emptyLabel: "Sem dados",       rowsLabel: "entidades"    }
};

export default async function MerchantsPage({
  searchParams
}: {
  searchParams: Promise<{ direction?: string; transfers?: string; outros?: string }>;
}) {
  const role = await getRole();
  if (role !== "admin" && role !== "health") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-on-surface-variant">Acesso restrito.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const direction: Direction = sp.direction === "in" ? "in" : sp.direction === "all" ? "all" : "out";
  const includeTransfers = sp.transfers === "1";
  const onlyOutros = sp.outros === "1";
  const copy = COPY[direction];

  const sb = serverClient();
  invalidateCache();
  await preloadClusters();

  const all: TxRow[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("transactions")
      .select("id, description_raw, real_amount, shared_amount, category_id, date, source, is_transfer")
      .eq("is_fake", false)
      .order("id", { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(`Failed to load transactions: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...(data as TxRow[]));
    if (data.length < 1000) break;
    off += 1000;
  }

  const filtered = all.filter((t) => {
    if (!includeTransfers && t.is_transfer) return false;
    const amt = fromDb(Number(t.real_amount));
    if (direction === "out") return amt < 0;
    if (direction === "in") return amt > 0;
    return true;
  });

  const [{ data: cats }, { data: tagsData }] = await Promise.all([
    sb.from("categories").select("id, slug, name"),
    sb.from("reimbursement_tags").select("id, slug, name, color, icon").order("name")
  ]);

  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);
  const outrosId = (cats ?? []).find((c) => c.slug === "outros")?.id as string;

  const groups = new Map<string, MerchantGroup>();
  // Also track txId → clusterKey for tag join
  const txIdToClusterKey = new Map<string, string>();

  for (const t of filtered) {
    const c = clusterFor(t.description_raw);
    txIdToClusterKey.set(t.id, c.key);
    if (!groups.has(c.key)) {
      groups.set(c.key, {
        key: c.key, name: c.name,
        txCount: 0, totalAbs: 0, totalSigned: 0,
        categoryIds: new Map(), uniqueDescriptions: new Set(),
        hiddenCount: 0, shownCount: 0, adjustedCount: 0
      });
    }
    const g = groups.get(c.key)!;
    g.txCount++;
    const amt = fromDb(Number(t.real_amount));
    const sharedAmt = fromDb(Number(t.shared_amount));
    g.totalAbs += Math.abs(amt);
    g.totalSigned += amt;
    g.uniqueDescriptions.add(t.description_raw);
    const catKey = t.category_id ?? "__none__";
    g.categoryIds.set(catKey, (g.categoryIds.get(catKey) ?? 0) + 1);
    if (sharedAmt === 0) g.hiddenCount++;
    else if (sharedAmt === amt) g.shownCount++;
    else g.adjustedCount++;
  }

  // Fetch tag assignments for all filtered transactions and map to cluster keys
  const tagIdToSlug = new Map<string, string>();
  for (const tg of tagsData ?? []) tagIdToSlug.set(tg.id as string, tg.slug as string);

  const clusterTagCounts = new Map<string, Map<string, number>>(); // clusterKey → tagSlug → count
  if (filtered.length > 0) {
    const txIds = filtered.map((t) => t.id);
    const TAG_CHUNK = 500;
    for (let i = 0; i < txIds.length; i += TAG_CHUNK) {
      const { data: tagRows } = await sb
        .from("transaction_reimbursements")
        .select("transaction_id, tag_id")
        .in("transaction_id", txIds.slice(i, i + TAG_CHUNK));
      for (const { transaction_id, tag_id } of (tagRows ?? []) as { transaction_id: string; tag_id: string }[]) {
        const ck = txIdToClusterKey.get(transaction_id);
        const slug = tagIdToSlug.get(tag_id);
        if (!ck || !slug) continue;
        if (!clusterTagCounts.has(ck)) clusterTagCounts.set(ck, new Map());
        const m = clusterTagCounts.get(ck)!;
        m.set(slug, (m.get(slug) ?? 0) + 1);
      }
    }
  }

  const allSorted = [...groups.values()].sort((a, b) => b.totalAbs - a.totalAbs);
  const inOutros = allSorted.filter((g) => {
    const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[0] === outrosId;
  });
  const sorted = onlyOutros ? inOutros : allSorted;
  const totalMerchants = sorted.length;
  const totalAbsAll = sorted.reduce((s, g) => s + g.totalAbs, 0);
  const totalHiddenMerchants = sorted.filter((g) => g.hiddenCount === g.txCount && g.txCount > 0).length;

  // Serialize groups for the client component (no Maps/Sets)
  const clientGroups: ClientMerchantGroup[] = sorted.map((g) => {
    const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
    const topCatId = top?.[0] ?? "__none__";
    const tagCounts: Record<string, number> = {};
    for (const tg of tagsData ?? []) {
      tagCounts[tg.slug as string] = clusterTagCounts.get(g.key)?.get(tg.slug as string) ?? 0;
    }
    return {
      key: g.key,
      name: g.name,
      txCount: g.txCount,
      totalAbs: g.totalAbs,
      totalSigned: g.totalSigned,
      catName: topCatId === "__none__" ? "—" : catNameById.get(topCatId) ?? "—",
      isOutros: topCatId === outrosId,
      mixedCat: g.categoryIds.size > 1,
      hiddenCount: g.hiddenCount,
      shownCount: g.shownCount,
      adjustedCount: g.adjustedCount,
      uniqueDescCount: g.uniqueDescriptions.size,
      tagCounts
    };
  });

  const clientTags: TagDef[] = (tagsData ?? []).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    color: t.color as string,
    icon: t.icon as string
  }));

  return (
    <>
    <PageHeader
      title={copy.title}
      crumbs={[{ href: "/admin", label: "Admin" }]}
      right={
        <div className="flex items-center bg-surface-container-high p-1 rounded-xl gap-0.5">
          <DirLink current={direction} value="out" includeTransfers={includeTransfers} label="Despesas" onlyOutros={onlyOutros} />
          <DirLink current={direction} value="in"  includeTransfers={includeTransfers} label="Receitas" onlyOutros={onlyOutros} />
          <DirLink current={direction} value="all" includeTransfers={includeTransfers} label="Tudo"     onlyOutros={onlyOutros} />
        </div>
      }
    />
    <div className="px-4 pt-5 max-w-5xl mx-auto pb-28">

      {/* Stats bento grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-1">Comerciantes</p>
          <p className="text-2xl font-semibold text-on-surface">{formatInt(totalMerchants)}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-1">Transações</p>
          <p className="text-2xl font-semibold text-on-surface">{formatInt(filtered.length)}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-1">Volume total</p>
          <p className="text-xl font-semibold text-on-surface tabular-nums">{formatBRL(totalAbsAll)}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-1">Escondidos</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-semibold text-on-surface">{formatInt(totalHiddenMerchants)}</p>
            {totalHiddenMerchants > 0 && (
              <span className="badge-hidden">oculto</span>
            )}
          </div>
        </div>
      </div>

      {/* "Outros" warning / filter toggle */}
      {inOutros.length > 0 && direction === "out" && (
        onlyOutros ? (
          <Link
            href={`/admin/merchants?direction=${direction}${includeTransfers ? "&transfers=1" : ""}`}
            className="mb-4 p-3 rounded-xl border border-amber-500/40 bg-[#f59e0b]/10 flex items-center gap-2.5 text-sm hover:bg-[#f59e0b]/15 transition"
          >
            <AlertCircle size={15} className="text-[#f59e0b] shrink-0" />
            <span className="text-on-surface flex-1">
              Mostrando <span className="font-semibold">{formatInt(inOutros.length)}</span> em &quot;Outros&quot; — clique para ver todos
            </span>
            <span className="text-xs text-[#f59e0b] font-semibold">✕ limpar filtro</span>
          </Link>
        ) : (
          <Link
            href={`/admin/merchants?direction=${direction}&outros=1${includeTransfers ? "&transfers=1" : ""}`}
            className="mb-4 p-3 rounded-xl border border-outline-variant bg-[#f59e0b]/5 flex items-center gap-2.5 text-sm hover:bg-[#f59e0b]/10 transition cursor-pointer"
          >
            <AlertCircle size={15} className="text-[#f59e0b] shrink-0" />
            <span className="text-on-surface">
              <span className="font-semibold">{formatInt(inOutros.length)}</span> ainda em &quot;Outros&quot; — clique para categorizar todas as ocorrências de uma vez.
            </span>
          </Link>
        )
      )}

      {/* Transfer toggle */}
      <div className="flex justify-end mb-3">
        <Link
          href={`/admin/merchants?direction=${direction}${onlyOutros ? "&outros=1" : ""}${includeTransfers ? "" : "&transfers=1"}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
        >
          <SlidersHorizontal size={12} />
          {includeTransfers ? "Ocultar" : "Mostrar"} transferências
        </Link>
      </div>

      {/* Main table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl soft-ambient-shadow overflow-hidden">

        <MerchantsClient
          groups={clientGroups}
          tags={clientTags}
          direction={direction}
          includeTransfers={includeTransfers}
          rowsLabel={copy.rowsLabel}
          emptyLabel={copy.emptyLabel}
          filteredCount={filtered.length}
        />
      </div>
    </div>
  </>
  );
}

function DirLink({
  current, value, label, includeTransfers, onlyOutros
}: {
  current: Direction; value: Direction; label: string; includeTransfers: boolean; onlyOutros?: boolean;
}) {
  const active = current === value;
  const outrosParam = onlyOutros ? "&outros=1" : "";
  return (
    <Link
      href={`/admin/merchants?direction=${value}${outrosParam}${includeTransfers ? "&transfers=1" : ""}`}
      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
        active
          ? "bg-surface-container-lowest shadow-sm text-primary font-bold"
          : "text-on-surface-variant hover:bg-surface-variant"
      }`}
    >
      {label}
    </Link>
  );
}
