/**
 * Display form for a provider name.
 *
 * The invoices store the legal company name in CAPITALS, exactly as the tax
 * authority holds it. A list of 23 shouted names is a wall — the eye cannot
 * find the one it wants, and the heaviest text on the screen ends up being the
 * least useful part of it. This lowercases for reading only; the stored value
 * is never modified.
 */

/** Legal-form and initialism tokens that stay uppercase. */
const KEEP_UPPER = new Set([
  "LTDA", "ME", "EPP", "EIRELI", "SA", "S/A", "SS", "S/S", "MEI", "CNPJ", "CRM", "CRP"
]);

/** Portuguese connectives stay lowercase inside a name. */
const KEEP_LOWER = new Set(["e", "de", "da", "do", "das", "dos", "em", "para"]);

export function displayProvider(raw: string | null | undefined): string {
  if (!raw) return "—";
  const words = raw.trim().split(/\s+/);

  return words
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;

      const lower = word.toLowerCase();
      // Connectives first: a lone "E" inside a Brazilian company name is the
      // word "e" far more often than an initial. "J E SILVA" reads slightly
      // wrong; "MILHARCIC E BAROSSI" reading as "E" looks broken on every row.
      if (i > 0 && KEEP_LOWER.has(lower)) return lower;
      // Initials like "D V KATZ" — a single letter is not a word to titlecase.
      if (word.length === 1) return upper;

      // Split on hyphen/slash so "SAO-PAULO" and "S/S" both read correctly.
      return lower.replace(/(^|[-/])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
    })
    .join(" ");
}
