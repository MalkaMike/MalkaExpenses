import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { getLang } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/translations";
import { BankSquare } from "@/components/bank-square";
import { PluggyConnectButton } from "@/components/pluggy-connect-button";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type ConnectedAccount = {
  id: string;
  name: string;
  bank: string;
  pluggy_last_sync: string | null;
};

export default async function ImportPage() {
  const role = await getRole();
  const lang = await getLang();
  const sb = serverClient();

  // Connected Open Finance accounts. Defensive: the pluggy_* columns may not
  // exist until migration 0004 is applied — on error we just show none.
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

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <h1 className="text-2xl font-semibold mb-1">{t("of.title", lang)}</h1>
      <p className="text-sm text-muted mb-6">{t("of.subtitle", lang)}</p>

      <section className="rounded-2xl bg-card border border-border p-5 mb-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">{t("of.label", lang)}</p>
        <h2 className="font-medium mb-1">{t("of.auto_title", lang)}</h2>
        <p className="text-sm text-muted mb-4">{t("of.auto_sub", lang)}</p>
        <PluggyConnectButton />
      </section>

      {connected.length > 0 && (
        <section className="mb-8">
          <h2 className="font-medium mb-3 px-1">{t("of.connected", lang)}</h2>
          <ul className="space-y-2">
            {connected.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border"
              >
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
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
