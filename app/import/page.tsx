import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { getLang } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/translations";
import { BankSquare } from "@/components/bank-square";
import { PluggyConnectButton } from "@/components/pluggy-connect-button";
import { formatDate, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

type ConnectedAccount = {
  id: string;
  name: string;
  bank: string;
  pluggy_last_sync: string | null;
};

function monthsBetween(from: string, toDate: string): number {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(toDate + "T00:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function ImportPage() {
  const role = await getRole();
  const lang = await getLang();
  const sb = serverClient();

  let connected: ConnectedAccount[] = [];
  const { data, error } = await sb
    .from("accounts")
    .select("id, name, bank, pluggy_last_sync")
    .not("pluggy_item_id", "is", null)
    .eq("is_archived", false)
    .order("name");
  if (!error && data) connected = data as ConnectedAccount[];

  if (role !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">{t("of.household_title", lang)}</h1>
        <p className="text-sm text-muted">{t("of.household_msg", lang)}</p>
      </div>
    );
  }

  // Coverage: oldest transaction date per account
  type Cov = { oldest: string | null; months: number; txCount: number };
  const coverageMap = new Map<string, Cov>();
  if (connected.length > 0) {
    await Promise.all(
      connected.map(async (a) => {
        const [{ data: oldest }, { count }] = await Promise.all([
          sb
            .from("transactions")
            .select("date")
            .eq("account_id", a.id)
            .order("date", { ascending: true })
            .limit(1),
          sb
            .from("transactions")
            .select("*", { count: "exact", head: true })
            .eq("account_id", a.id)
        ]);
        const oldestDate = (oldest?.[0]?.date as string) ?? null;
        coverageMap.set(a.id, {
          oldest: oldestDate,
          months: oldestDate ? monthsBetween(oldestDate, todayIso()) : 0,
          txCount: count ?? 0
        });
      })
    );
  }

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">{t("of.title", lang)}</h1>
        <p className="text-sm text-muted">{t("of.subtitle", lang)}</p>
      </div>

      {/* Open Finance connection */}
      <section className="rounded-2xl bg-card border border-border p-5">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">{t("of.label", lang)}</p>
        <h2 className="font-medium mb-1">{t("of.auto_title", lang)}</h2>
        <p className="text-sm text-muted mb-4">{t("of.auto_sub", lang)}</p>
        <PluggyConnectButton />
      </section>

      {/* Connected accounts + coverage */}
      {connected.length > 0 && (
        <section>
          <h2 className="font-medium mb-3 px-1">Contas conectadas &amp; cobertura</h2>
          <ul className="space-y-2">
            {connected.map((a) => {
              const cov = coverageMap.get(a.id);
              return (
                <li key={a.id} className="p-4 rounded-xl bg-card border border-border">
                  <div className="flex items-center gap-3">
                    <BankSquare bank={a.bank} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.name}</p>
                      <p className="text-xs text-muted">
                        {a.pluggy_last_sync
                          ? `${t("of.synced_on", lang)} ${formatDate(a.pluggy_last_sync.slice(0, 10))}`
                          : t("of.awaiting", lang)}
                      </p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden />
                  </div>

                  {cov && cov.txCount > 0 ? (
                    <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-base font-semibold tabular-nums">{cov.months}</p>
                        <p className="text-[10px] text-muted uppercase tracking-wide">
                          {cov.months === 1 ? "mês" : "meses"}
                        </p>
                      </div>
                      <div>
                        <p className="text-base font-semibold">
                          {cov.oldest ? formatDate(cov.oldest) : "—"}
                        </p>
                        <p className="text-[10px] text-muted uppercase tracking-wide">Desde</p>
                      </div>
                      <div>
                        <p className="text-base font-semibold tabular-nums">{formatInt(cov.txCount)}</p>
                        <p className="text-[10px] text-muted uppercase tracking-wide">Movimentos</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted/60 italic">Aguardando primeiro sync…</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
