import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { sharedClient } from "@/lib/supabase/shared-client";
import { formatBRL, monthLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

type MonthRow = { month: string; sharedTotal: number; realTotal: number | null };

export default async function MonthsPage() {
  const role = await getRole();

  let months: MonthRow[] = [];
  const monthMap = new Map<string, { shared: number; real: number }>();

  if (role !== "admin") {
    const sb = sharedClient();
    const { data } = await sb
      .from("shared_transactions_v")
      .select("date, amount, is_transfer")
      .eq("is_transfer", false)
      .order("date", { ascending: false });
    for (const r of data ?? []) {
      const m = (r.date as string).slice(0, 7);
      const cur = monthMap.get(m) ?? { shared: 0, real: 0 };
      cur.shared += Number(r.amount);
      monthMap.set(m, cur);
    }
    months = Array.from(monthMap.entries()).map(([month, v]) => ({
      month,
      sharedTotal: v.shared,
      realTotal: null
    }));
  } else {
    const sb = serverClient();
    const { data } = await sb
      .from("transactions")
      .select("date, real_amount, shared_amount, is_transfer")
      .eq("is_transfer", false)
      .order("date", { ascending: false });
    for (const r of data ?? []) {
      const m = (r.date as string).slice(0, 7);
      const cur = monthMap.get(m) ?? { shared: 0, real: 0 };
      cur.shared += Number(r.shared_amount);
      cur.real += Number(r.real_amount);
      monthMap.set(m, cur);
    }
    months = Array.from(monthMap.entries()).map(([month, v]) => ({
      month,
      sharedTotal: v.shared,
      realTotal: v.real
    }));
  }

  months.sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Meses</h1>
      {months.length === 0 && <p className="text-sm text-muted">Sem dados ainda.</p>}
      <ul className="space-y-2">
        {months.map((m) => (
          <li
            key={m.month}
            className="flex items-center justify-between p-4 rounded-xl bg-card border border-border"
          >
            <span className="font-medium">{monthLabel(m.month)}</span>
            <div className="text-right">
              <p className={`tabular-nums font-semibold ${m.sharedTotal >= 0 ? "text-accent" : ""}`}>
                {formatBRL(m.sharedTotal)}
              </p>
              {m.realTotal !== null && m.realTotal !== m.sharedTotal && (
                <p className="text-xs text-muted tabular-nums">real {formatBRL(m.realTotal)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
