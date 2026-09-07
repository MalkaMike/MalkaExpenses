// Pure, no server-only — unit-testable. Shared by lib/merchants/merchant-rules.ts
// (writes rules) and lib/pluggy/sync.ts (matches rules against new transactions).

/** First 3 words of a raw description — the pattern merchant_rules matches on. */
export function derivePattern(descriptionRaw: string): string | null {
  const pattern = descriptionRaw.trim().split(/\s+/).slice(0, 3).join(" ");
  return pattern.length >= 3 ? pattern : null;
}

export function matchesRulePattern(
  rule: { pattern: string; pattern_type: string },
  descLower: string
): boolean {
  const pat = rule.pattern.toLowerCase();
  if (rule.pattern_type === "exact") return descLower === pat;
  if (rule.pattern_type === "starts_with") return descLower.startsWith(pat);
  return descLower.includes(pat);
}
