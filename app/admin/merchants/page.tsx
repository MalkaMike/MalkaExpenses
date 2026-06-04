import Link from "next/link";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

type TxRow = {
  id: string;
  description_raw: string;
  real_amount: number;
  category_id: string | null;
  date: string;
  source: string;
};

type MerchantGroup = {
  key: string;
  name: string;
  txCount: number;
  totalAbs: number;
  totalSigned: number;
  categoryIds: Map<string, number>;
  uniqueDescriptions: Set<string>;
};

type Direction = "out" | "in" | "all";

const COPY: Record<Direction, { title: string; subtitle: string; emptyLabel: string; rowsLabel: string }> = {
  out: { title: "Comerciantes (despesas)", subtitle: "para onde sai o dinheiro", emptyLabel: "Nenhuma despesa", rowsLabel: "comerciantes" },
  in:  { title: "Pagadores (receitas)",    subtitle: "de onde vem o dinheiro",  emptyLabel: "Nenhuma receita", rowsLabel: "pagadores" },
  all: { title: "Tudo (despesas + receitas)", subtitle: "todos os comerciantes/pagadores", emptyLabel: "Sem dados", rowsLabel: "entidades" }
};

export default async function MerchantsPage({
  searchParams
}: {
  searchParams: Promise<{ direction?: string }>;
}) {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const direction: Direction = sp.direction === "in" ? "in" : sp.direction === "all" ? "all" : "out";
  const copy = COPY[direction];

  const sb = serverClient();

  // Preload cluster mapping (from DB if available, JSON fallback otherwise)
  await preloadClusters();

  // Pull all transactions in pages (Supabase 1000-row cap).
  // Deterministic .order("id") prevents skipped/duplicated rows under
  // concurrent writes.
  const all: TxRow[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("transactions")
      .select("id, description_raw, real_amount, category_id, date, source")
      .order("id", { ascending: true })
      .range(off, off + 999);
    if (error) {
      throw new Error(`Failed to load transactions: ${error.message}`);
    }
    if (!data || !data.length) break;
    all.push(...(data as TxRow[]));
    if (data.length < 1000) break;
    off += 1000;
  }

  // Filter by direction
  const filtered = all.filter((t) => {
    const amt = Number(t.real_amount);
    if (direction === "out") return amt < 0;
    if (direction === "in") return amt > 0;
    return true;
  });

  // Categories lookup
  const { data: cats } = await sb.from("categories").select("id, slug, name");
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);
  const outrosId = (cats ?? []).find((c) => c.slug === "outros")?.id as string;

  // Group by canonical merchant
  const groups = new Map<string, MerchantGroup>();
  for (const t of filtered) {
    const c = clusterFor(t.description_raw);
    if (!groups.has(c.key)) {
      groups.set(c.key, {
        key: c.key,
        name: c.name,
        txCount: 0,
        totalAbs: 0,
        totalSigned: 0,
        categoryIds: new Map(),
        uniqueDescriptions: new Set()
      });
    }
    const g = groups.get(c.key)!;
    g.txCount++;
    const amt = Number(t.real_amount);
    g.totalAbs += Math.abs(amt);
    g.totalSigned += amt;
    g.uniqueDescriptions.add(t.description_raw);
    const catKey = t.category_id ?? "__none__";
    g.categoryIds.set(catKey, (g.categoryIds.get(catKey) ?? 0) + 1);
  }

  const sorted = [...groups.values()].sort((a, b) => b.totalAbs - a.totalAbs);
  const totalMerchants = sorted.length;
  const inOutros = sorted.filter((g) => {
    const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[0] === outrosId;
  });
  const totalAbsAll = sorted.reduce((s, g) => s + g.totalAbs, 0);

  return (
    <div className="px-4 pt-6 max-w-5xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">{copy.title}</h1>
        <p className="text-xs text-muted mt-1">
          {copy.subtitle} · {filtered.length} transações em{" "}
          <span className="text-fg">{totalMerchants}</span> {copy.rowsLabel}. Volume:{" "}
          <span className="text-fg tabular-nums">{formatBRL(totalAbsAll)}</span>.
        </p>
      </header>

      {/* Toggle */}
      <nav className="inline-flex p-1 mb-4 rounded-xl bg-fg/[0.06] border border-border text-sm">
        <DirLink current={direction} value="out" label="Despesas" />
        <DirLink current={direction} value="in" label="Receitas" />
        <DirLink current={direction} value="all" label="Tudo" />
      </nav>

      {inOutros.length > 0 && direction === "out" && (
        <div className="mb-4 p-3 rounded-xl border border-warning/30 bg-warning/5 flex items-center gap-2 text-sm">
          <AlertCircle size={16} className="text-warning shrink-0" />
          <span>
            <span className="font-medium">{inOutros.length}</span> ainda em &quot;Outros&quot; — clique para categorizar todas as ocorrências de uma vez.
          </span>
        </div>
      )}

      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_100px_140px_24px] gap-3 px-4 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted font-medium">
          <span>{direction === "in" ? "Pagador" : "Comerciante"}</span>
          <span className="text-right">Vezes</span>
          <span className="text-right">Variações</span>
          <span className="text-right">Total</span>
          <span></span>
        </div>
        <ul className="divide-y divide-border">
          {sorted.map((g) => {
            const top = [...g.categoryIds.entries()].sort((a, b) => b[1] - a[1])[0];
            const topCatId = top?.[0] ?? "__none__";
            const isOutros = topCatId === outrosId;
            const mixedCat = g.categoryIds.size > 1;
            const catName =
              topCatId === "__none__" ? "—" : catNameById.get(topCatId) ?? "—";

            return (
              <li key={g.key}>
                <Link
                  href={`/admin/merchants/${encodeURIComponent(g.key)}?direction=${direction}`}
                  className="grid grid-cols-[1fr_80px_100px_140px_24px] gap-3 px-4 py-3 items-center hover:bg-fg/[0.03] active:bg-fg/[0.06] transition"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{g.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          isOutros
                            ? "bg-warning/15 text-warning"
                            : "bg-accent/10 text-accent"
                        }`}
                      >
                        {catName}
                        {mixedCat ? " +" : ""}
                      </span>
                    </div>
                  </div>
                  <span className="text-right tabular-nums text-sm text-muted">
                    {g.txCount}
                  </span>
                  <span className="text-right tabular-nums text-sm text-muted">
                    {g.uniqueDescriptions.size}
                  </span>
                  <span
                    className={`text-right tabular-nums font-medium ${
                      direction === "in" ? "text-accent" : ""
                    }`}
                  >
                    {formatBRL(g.totalAbs)}
                  </span>
                  <ChevronRight size={14} className="text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
        {sorted.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">{copy.emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function DirLink({
  current,
  value,
  label
}: {
  current: Direction;
  value: Direction;
  label: string;
}) {
  const active = current === value;
  return (
    <Link
      href={`/admin/merchants?direction=${value}`}
      className={`px-3 py-1.5 rounded-lg transition font-medium ${
        active ? "bg-fg text-bg" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
