import "server-only";

// ============================================================================
// Value-matching utilities — finds occurrences of a BRL amount inside text.
// Tolerates the many ways Brazilians write R$ values:
//   R$ 1.234,56   R$1.234,56   1234,56   R$ 1234.56   1234.56   $1,234.56
//   1.234,56 reais   total: R$1.234,56   valor total R$ 1.234,56
// ============================================================================

/** Normalize a BRL-formatted string into a number.
 *  Returns null if not parseable as a positive amount. */
export function parseBRL(s: string): number | null {
  // Strip R$, leading/trailing spaces
  const cleaned = s.replace(/\bR\$?\b/gi, "").replace(/\bBRL\b/gi, "").trim();
  // Detect format:
  //   "1.234,56" → Brazilian (dot = thousand, comma = decimal)
  //   "1,234.56" → US (comma = thousand, dot = decimal)
  //   "1234,56"  → Brazilian
  //   "1234.56"  → ambiguous; treat as decimal-dot
  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    // The LAST separator is the decimal one
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Brazilian: dots = thousands, comma = decimal
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US: commas = thousands, dot = decimal
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Only comma — treat as decimal separator (BR style)
    normalized = cleaned.replace(",", ".");
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100; // round to cents
}

/** Returns ALL parsed amounts found in the text, with their character offsets. */
export function findAllAmounts(text: string): Array<{ amount: number; raw: string; pos: number }> {
  if (!text) return [];
  // Match patterns like: R$ 1.234,56 | R$1234,56 | 1.234,56 | 1234,56 | 1,234.56 | 1234.56
  // Require at least 2 digits before decimals to avoid false positives like "R$ 5"
  const RE = /(?:R\$\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g;
  const out: Array<{ amount: number; raw: string; pos: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const parsed = parseBRL(m[1]);
    if (parsed !== null) {
      out.push({ amount: parsed, raw: m[0], pos: m.index });
    }
  }
  return out;
}

/** Returns true if any amount in `text` is within `toleranceCents` of `target`. */
export function textContainsAmount(text: string, target: number, toleranceCents = 1): {
  found: boolean;
  match?: { amount: number; raw: string; pos: number };
} {
  const targetCents = Math.round(target * 100);
  for (const m of findAllAmounts(text)) {
    if (Math.abs(Math.round(m.amount * 100) - targetCents) <= toleranceCents) {
      return { found: true, match: m };
    }
  }
  return { found: false };
}

/** Returns a context snippet around a position (for UI display). */
export function snippet(text: string, pos: number, radius = 60): string {
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}
