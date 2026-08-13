import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { guidanceFor, askSteps, type ClaimOwner } from "@/lib/health/claim-guidance";
import { providerKey } from "@/lib/health/provider-group";

/**
 * Resolve a provider key from the URL back to real invoices.
 *
 * Everything provider-scoped — ticking a step, storing a document — is
 * addressed by a key that arrives in the URL. Without this check the key is
 * whatever the caller typed, so a stale tab or a curl could write steps and
 * files against a folder that belongs to no invoice at all.
 */
export type ResolvedProvider = {
  key: string;
  providerName: string;
  steps: { text: string; owner: ClaimOwner }[];
  owner: ClaimOwner;
};

export async function resolveProvider(
  key: string,
  role: string | null
): Promise<ResolvedProvider | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(key)) return null;

  const sb = serverClient();
  const { data, error } = await sb
    .from("nota_fiscais")
    .select("provider_name, provider_cnpj, nf_number")
    .eq("is_medical", true);
  if (error || !data) return null;

  const match = data.find(
    (nf) => providerKey(nf.provider_cnpj as string | null, nf.provider_name as string | null) === key
  );
  if (!match) return null;

  const guidance = guidanceFor(
    match.provider_name as string | null,
    match.nf_number as string | null
  );

  // The secretary's queue hides the providers that are Mickael's or frozen
  // pending the broker. Hiding them in the UI is presentation; refusing the
  // write here is the actual rule.
  if (role === "secretary" && guidance.owner !== "secretary") return null;

  return {
    key,
    providerName: (match.provider_name as string) ?? "—",
    steps: askSteps(guidance),
    owner: guidance.owner
  };
}
