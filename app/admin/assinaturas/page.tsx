import { redirect } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getRecurringPayments } from "@/lib/pluggy/client";
import { PageHeader } from "@/components/page-header";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export default async function AssinaturasPage() {
  const role = await getRole();
  if (role !== "admin") redirect("/login?next=/admin/assinaturas");

  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("pluggy_item_id, name")
    .not("pluggy_item_id", "is", null)
    .eq("is_archived", false);

  const itemIds = [...new Set((accounts ?? []).map((a) => a.pluggy_item_id as string))];

  const results = await Promise.allSettled(itemIds.map((id) => getRecurringPayments(id)));

  const all = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getRecurringPayments>>> =>
      r.status === "fulfilled"
    )
    .flatMap((r) => r.value)
    .sort((a, b) => Math.abs(b.averageAmount) - Math.abs(a.averageAmount));

  const errors = results.filter((r) => r.status === "rejected").length;

  const expenses = all.filter((r) => r.averageAmount < 0);
  const income = all.filter((r) => r.averageAmount >= 0);
  const totalMonthly = expenses.reduce((s, r) => s + Math.abs(r.averageAmount), 0);

  return (
    <>
      <PageHeader title="Assinaturas & Recorrentes" />
      <div className="px-6 pt-6 max-w-2xl mx-auto pb-28">

        {errors > 0 && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-error-container/30 border border-error/40 text-sm text-on-error-container">
            {errors} conta(s) não retornaram dados — tente novamente mais tarde.
          </div>
        )}

        {all.length === 0 && errors === 0 && (
          <div className="px-4 py-10 rounded-xl border border-outline-variant bg-surface-container-lowest text-center">
            <RefreshCw size={28} className="text-on-surface-variant mx-auto mb-3" />
            <p className="text-sm text-on-surface font-medium">Nenhum padrão detectado ainda</p>
            <p className="text-xs text-on-surface-variant mt-1">
              A Pluggy precisa de pelo menos 3 ocorrências mensais para identificar uma recorrência.
            </p>
          </div>
        )}

        {expenses.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Saídas recorrentes
              </p>
              <p className="text-xs text-on-surface-variant tabular-nums">
                {formatBRL(totalMonthly)}/mês
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden divide-y divide-outline-variant">
              {expenses.map((r, i) => (
                <RecurringRow key={i} item={r} />
              ))}
            </div>
          </section>
        )}

        {income.length > 0 && (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">
              Entradas recorrentes
            </p>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden divide-y divide-outline-variant">
              {income.map((r, i) => (
                <RecurringRow key={i} item={r} />
              ))}
            </div>
          </section>
        )}

        <p className="text-[10px] text-on-surface-variant mt-8 text-center">
          Detectado pela Pluggy · aparece com ≥3 ocorrências mensais e variação de valor ≤10%
        </p>
      </div>
    </>
  );
}

function RecurringRow({
  item,
}: {
  item: { description: string; averageAmount: number; occurrences: string[]; regularityScore: number };
}) {
  const isExpense = item.averageAmount < 0;
  const scorePercent = Math.round(item.regularityScore * 100);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface capitalize truncate">{item.description}</p>
        <p className="text-xs text-on-surface-variant mt-0.5">
          {item.occurrences.length}× · regularidade {scorePercent}%
        </p>
      </div>
      <p
        className={`text-sm font-semibold tabular-nums shrink-0 ${
          isExpense ? "text-error" : "text-secondary"
        }`}
      >
        {formatBRL(Math.abs(item.averageAmount))}
        <span className="text-xs font-normal text-on-surface-variant">/mês</span>
      </p>
    </div>
  );
}
