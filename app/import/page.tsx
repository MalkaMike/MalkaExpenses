import { serverClient } from "@/lib/supabase/server";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const sp = await searchParams;
  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name, bank, type")
    .eq("is_archived", false)
    .order("name");

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Importar extrato</h1>
      <ImportClient accounts={accounts ?? []} defaultAccountId={sp.account} />
    </div>
  );
}
