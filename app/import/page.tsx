import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";
import { ImportClient } from "./import-client";
import { PluggyConnectButton } from "@/components/pluggy-connect-button";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const sp = await searchParams;
  const role = await getRole();
  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name, bank, type")
    .eq("is_archived", false)
    .order("name");

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Importar extrato</h1>

      {role === "admin" && (
        <section className="mb-6 rounded-2xl bg-card border border-border p-5">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">Open Finance</p>
          <h2 className="font-medium mb-1">Conexão automática</h2>
          <p className="text-sm text-muted mb-4">
            Conecte seu banco via Open Finance e as transações entram sozinhas —
            sem precisar baixar extrato. Você continua no controle do que aparece.
          </p>
          <PluggyConnectButton />
          <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted">
            <span className="flex-1 h-px bg-border" />
            ou importe um arquivo
            <span className="flex-1 h-px bg-border" />
          </div>
        </section>
      )}

      <ImportClient accounts={accounts ?? []} defaultAccountId={sp.account} />
    </div>
  );
}
