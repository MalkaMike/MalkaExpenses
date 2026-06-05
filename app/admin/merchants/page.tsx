import Link from "next/link";
import { ChevronRight, AlertCircle, EyeOff, SlidersHorizontal } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters, invalidateCache } from "@/lib/merchants/clusters";
import { formatBRL, formatInt } from "@/lib/format";

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
  searchParams: Promise<{ direction?: string; transfers?: string }>;
}) {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-on-surface-variant">Acesso restrito.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const direction: Direction = sp.direction === "in" ? "in" : sp.direction === "all" ? "all" : "out";
  const includeTransfers = sp.transfers === "1";
  const copy = COPY[direction];

  const sb = serverClient();
  // Always force a fresh DB load — the in-memory module cache is per-process and
  // can be 60s stale on a different Vercel warm instance after a merge/rename.
  invalidateCache();
  await preloadClusters();

  const all: TxRow[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("transactions")
      .select("id, description_raw, real_amount, shared_amount, category_id, date, source, is_transfer")
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
    const amt = Number(t.real_amount);
    if (direction === "out") return amt < 0;
    if (direction === "in") return amt > 0;
    return true;
  });

  const { data: cats } = await sb.from("categories").select("id, slug, name");
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);
  const outrosId = (cats ?? []).find((c) => c.slug === "outros")?.id as string;

  const groups = new Map<string, MerchantGroup>();
  for (const t of filtered) {
    const c = clusterFor(t.description_raw);
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
    const amt = Number(t.real_amount);
    const sharedAmt = Number(t.shared_amount);
    g.totalAbs += Math.abs(amt);
    g.totalSigned += amt;
    g.uniqueDescriptions.add(t.description_raw);
    const catKey = t.category_id ?? "__none__";
    g.categoryIds.set(catKey, (g.categoryIds.get(catKey) ?? 0) + 1);
    if (sharedAmt === 0) g.hiddenCount++;
    else if (sharedAmt === amt) g.shownCount++;
    else g.adjustedCount++;
  }

  const sorted = [...groups.values()].sort((a, b) => b.totalAbs - a.totalAbs);
  const totalMerchants = sorted.length;
  const inOutros = sorted.filter((g) => {
    const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[0] === outrosId;
  });
  const totalAbsAll = sorted.reduce((s, g) => s + g.totalAbs, 0);
  const totalHiddenMerchants = sorted.filter((g) => g.hiddenCount === g.txCount && g.txCount > 0).length;

  return (
    <>
    <PageHeader
      title={copy.title}
      crumbs={[{ href: "/admin", label: "Admin" }]}
      right={
        <div className="flex items-center bg-surface-container-high p-1 rounded-xl gap-0.5">
          <DirLink current={direction} value="out" includeTransfers={includeTransfers} label="Despesas" />
          <DirLink current={direction} value="in"  includeTransfers={includeTransfers} label="Receitas" />
          <DirLink current={direction} value="all" includeTransfers={includeTransfers} label="Tudo" />
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

      {/* "Outros" warning */}
      {inOutros.length > 0 && direction === "out" && (
        <div className="mb-4 p-3 rounded-xl border border-outline-variant bg-[#f59e0b]/5 flex items-center gap-2.5 text-sm">
          <AlertCircle size={15} className="text-[#f59e0b] shrink-0" />
          <span className="text-on-surface">
            <span className="font-semibold">{formatInt(inOutros.length)}</span> ainda em &quot;Outros&quot; — clique para categorizar todas as ocorrências de uma vez.
          </span>
        </div>
      )}

      {/* Transfer toggle */}
      <div className="flex justify-end mb-3">
        <Link
          href={`/admin/merchants?direction=${direction}${includeTransfers ? "" : "&transfers=1"}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
        >
          <SlidersHorizontal size={12} />
          {includeTransfers ? "Ocultar" : "Mostrar"} transferências
        </Link>
      </div>

      {/* Main table — Stitch high-density style */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl soft-ambient-shadow overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[28px_1fr_60px_72px_124px_16px] gap-3 px-4 py-3 border-b border-outline-variant bg-surface-container-low">
          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant text-center">#</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
            {direction === "in" ? "Pagador" : "Comerciante"}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Vezes</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Variações</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Total</span>
          <span></span>
        </div>

        {/* Rows */}
        <ul className="divide-y divide-outline-variant">
          {sorted.map((g, idx) => {
            const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
            const topCatId = top?.[0] ?? "__none__";
            const isOutros = topCatId === outrosId;
            const mixedCat = g.categoryIds.size > 1;
            const catName = topCatId === "__none__" ? "—" : catNameById.get(topCatId) ?? "—";
            const allHidden = g.hiddenCount === g.txCount && g.txCount > 0;
            const partialHidden = g.hiddenCount > 0 && g.hiddenCount < g.txCount;
            const initial = (g.name[0] ?? "?").toUpperCase();
            const rank = idx + 1;
            // Top-3 visual emphasis
            const isTopThree = rank <= 3;

            return (
              <li key={g.key} className="relative">
                <Link
                  href={`/admin/merchants/${encodeURIComponent(g.key)}?direction=${direction}${includeTransfers ? "&transfers=1" : ""}`}
                  className="grid grid-cols-[28px_1fr_60px_72px_124px_16px] gap-3 px-4 py-2.5 items-center hover:bg-surface-container transition-colors group relative"
                >
                  {/* Rank number */}
                  <span
                    className={`text-center text-[11px] tabular-nums font-bold ${
                      isTopThree ? "text-on-surface" : "text-on-surface-variant/50"
                    }`}
                  >
                    {rank}
                  </span>

                  {/* Merchant info */}
                  <div className="min-w-0 flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{
                        background: allHidden ? "#f59e0b18" : direction === "in" ? "#6cf8bb30" : "#efeeeb",
                        color: allHidden ? "#f59e0b" : direction === "in" ? "#006c49" : "#1b1c1a"
                      }}
                    >
                      {allHidden ? <EyeOff size={12} /> : initial}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[13px] text-on-surface truncate leading-tight">{g.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {/* Category badge */}
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                            isOutros
                              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                              : "bg-surface-container-highest text-on-surface-variant"
                          }`}
                        >
                          {catName}{mixedCat ? " +" : ""}
                        </span>
                        {/* Hidden badges */}
                        {allHidden && (
                          <span className="text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#f59e0b] text-black font-bold uppercase tracking-wider">
                            <EyeOff size={8} /> Oculto
                          </span>
                        )}
                        {partialHidden && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-[#f59e0b]/10 text-[#f59e0b] uppercase tracking-wider">
                            {g.hiddenCount}/{g.txCount} ocultas
                          </span>
                        )}
                        {g.adjustedCount > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
                            {g.adjustedCount} ajust.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Count */}
                  <span className="text-right text-[13px] tabular-nums text-on-surface-variant">
                    {formatInt(g.txCount)}
                  </span>

                  {/* Variations */}
                  <span className="text-right text-[13px] tabular-nums text-on-surface-variant">
                    {formatInt(g.uniqueDescriptions.size)}
                  </span>

                  {/* Total */}
                  <span
                    className={`text-right text-[13px] font-semibold tabular-nums ${
                      direction === "in" ? "text-secondary" : "text-on-tertiary-container"
                    }`}
                  >
                    {formatBRL(g.totalAbs)}
                  </span>

                  <ChevronRight size={13} className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition" />
                </Link>
              </li>
            );
          })}
        </ul>

        {sorted.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-on-surface-variant">{copy.emptyLabel}</p>
        )}

        {/* Table footer */}
        <div className="bg-surface-container-low px-4 py-2.5 border-t border-outline-variant">
          <span className="text-xs text-on-surface-variant">
            {formatInt(sorted.length)} {copy.rowsLabel} · {formatInt(filtered.length)} transações
          </span>
        </div>
      </div>
    </div>
  </>
  );
}

function DirLink({
  current, value, label, includeTransfers
}: {
  current: Direction; value: Direction; label: string; includeTransfers: boolean;
}) {
  const active = current === value;
  return (
    <Link
      href={`/admin/merchants?direction=${value}${includeTransfers ? "&transfers=1" : ""}`}
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
