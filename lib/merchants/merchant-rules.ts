import "server-only";
import type { serverClient } from "@/lib/supabase/server";

export { derivePattern } from "@/lib/merchants/rule-pattern";

type SB = ReturnType<typeof serverClient>;

/**
 * Create or update the merchant_rules row for `pattern`, touching only the
 * fields in `patch` — an existing rule's other field (category_id or
 * reimbursement_tag_id) is left as-is, so a category correction and a
 * reimbursement tag on the same supplier don't clobber each other.
 */
export async function upsertMerchantRule(
  sb: SB,
  pattern: string,
  patch: { category_id?: string; reimbursement_tag_id?: string | null; confidence_default?: number },
  createdFromTransactionId?: string
): Promise<void> {
  const { data: existingRule } = await sb
    .from("merchant_rules")
    .select("id")
    .eq("pattern", pattern)
    .maybeSingle();
  if (existingRule) {
    await sb.from("merchant_rules").update(patch).eq("id", existingRule.id);
  } else {
    await sb.from("merchant_rules").insert({
      pattern,
      pattern_type: "contains",
      confidence_default: 0.95,
      created_from_transaction_id: createdFromTransactionId ?? null,
      ...patch
    });
  }
}

/**
 * How many OTHER suppliers (distinct merchant_clusters.canonical_key, not
 * `excludeCanonicalKey`) does this pattern's "contains" match also reach?
 *
 * Exists because a 3-word pattern can look supplier-specific while actually
 * being a generic phrase — "Pagamento de boleto" matched 22 unrelated
 * suppliers (school tuition, condo, ...) in production on 2026-09-06,
 * because the only boletos tagged Plano so far happened to start with those
 * words. A rule built from that pattern would auto-tag the NEXT unrelated
 * boleto as a health reimbursement claim and hide it from the shared ledger.
 *
 * Returns a large sentinel (not 0) on a failed read — a check that can't run
 * must not silently look like "safe to write the rule".
 */
export async function countOtherSuppliersMatchingPattern(
  sb: SB,
  pattern: string,
  excludeCanonicalKey: string
): Promise<number> {
  const { data, error } = await sb
    .from("merchant_clusters")
    .select("canonical_key")
    .ilike("description_raw", `%${pattern}%`)
    .neq("canonical_key", excludeCanonicalKey);
  if (error) return Infinity;
  return new Set((data ?? []).map((r) => r.canonical_key as string)).size;
}
