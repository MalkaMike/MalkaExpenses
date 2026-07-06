import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { SuggestionsClient } from "./suggestions-client";
import { serverClient } from "@/lib/supabase/server";
import { fromDb } from "@/lib/money";
import { formatBRL, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

type ThresholdStats = {
  threshold: number;
  label: string;
  count: number;
  total: number;
  perMonth: number;
};

async function loadThresholdStats(): Promise<{ rows: ThresholdStats[]; months: number; totalAll: number; countAll: number }> {
  const sb = serverClient();
  const today = new Date().toISOString().split("T")[0];

  // Both fetches paginated (PostgREST caps at 1000/request; live counts are
  // 4,451 candidate expenses and 1,356 reviewed clusters — the old unbounded
  // reads truncated both, so the R$ totals under- AND over-counted) and run
  // in parallel (they're independent).
  const PAGE = 1000;
  async function loadExpenses() {
    const out: Array<{ real_amount: number; date: string; description_raw: string }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await sb
        .from("transactions")
        .select("real_amount, date, description_raw")
        .eq("is_fake", false)
        .eq("is_transfer", false)
        .lte("date", today)
        .lt("real_amount", 0)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((page ?? []) as typeof out));
      if (!page || page.length < PAGE) break;
    }
    return out;
  }
  async function loadReviewedDescs() {
    const out = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await sb
        .from("merchant_clusters")
        .select("description_raw")
        .or("is_reviewed.eq.true,is_deferred.eq.true")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of page ?? []) out.add(r.description_raw as string);
      if (!page || page.length < PAGE) break;
    }
    return out;
  }

  const [txRows, skipDescs] = await Promise.all([loadExpenses(), loadReviewedDescs()]);

  if (!txRows.length) return { rows: [], months: 0, totalAll: 0, countAll: 0 };

  const unreviewed = txRows.filter((t) => !skipDescs.has(t.description_raw as string));
  if (!unreviewed.length) return { rows: [], months: 0, totalAll: 0, countAll: 0 };

  // Month span
  const dates = unreviewed.map((t) => t.date as string).sort();
  const [minY, minM] = dates[0].split("-").map(Number);
  const [maxY, maxM] = dates[dates.length - 1].split("-").map(Number);
  const months = Math.max(1, (maxY - minY) * 12 + (maxM - minM) + 1);

  const THRESHOLDS = [200, 150, 100, 50];
  const rows: ThresholdStats[] = THRESHOLDS.map((t) => {
    const subset = unreviewed.filter((tx) => Math.abs(fromDb(Number(tx.real_amount))) <= t);
    const total = subset.reduce((s, tx) => s + Math.abs(fromDb(Number(tx.real_amount))), 0);
    return { threshold: t, label: `R$${t}`, count: subset.length, total, perMonth: total / months };
  });

  const totalAll = unreviewed.reduce((s, tx) => s + Math.abs(fromDb(Number(tx.real_amount))), 0);

  return { rows, months, totalAll, countAll: unreviewed.length };
}

export default async function SuggestionsPage() {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-on-surface-variant">Acesso restrito.</p>
      </div>
    );
  }

  const { rows, months, totalAll, countAll } = await loadThresholdStats();

  return (
    <>
      <PageHeader title="Sugestões de fusão" crumbs={[{ href: "/admin", label: "Admin" }]} />
      <div className="px-4 pt-5 max-w-4xl mx-auto pb-28">
        <p className="text-sm text-on-surface-variant mb-5">
          Pares de merchants que parecem ser a mesma coisa — possíveis duplicatas
          causadas por descrições ligeiramente diferentes do banco.
        </p>

        {/* Threshold stats — unreviewed transactions */}
        {rows.length > 0 && (
          <div className="mb-8">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
              Para revisar — transações por valor máximo · {months} meses de dados
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {rows.map((r) => (
                <div key={r.threshold} className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                    Abaixo de {r.label}
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-on-surface">{formatBRL(r.total)}</p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 tabular-nums">
                    {formatBRL(r.perMonth)}<span className="font-normal">/mês</span>
                    <span className="ml-1.5 opacity-60">· {formatInt(r.count)} transações</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl soft-ambient-shadow flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Total ainda por revisar</p>
                <p className="text-2xl font-semibold tabular-nums text-on-surface">{formatBRL(totalAll)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Por mês</p>
                <p className="text-xl font-semibold tabular-nums text-on-surface">{formatBRL(totalAll / months)}</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">{formatInt(countAll)} transações</p>
              </div>
            </div>
          </div>
        )}

        <SuggestionsClient />
      </div>
    </>
  );
}
