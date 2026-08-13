/**
 * Naming rules for the documents the secretary collects against a claim.
 *
 * Two jobs, both about not losing evidence:
 *  - `safeName` strips anything that could escape the claim's folder.
 *  - `freeName` refuses to reuse a name that is already taken. Scanners and
 *    phones hand back "documento.pdf" or "Scan.jpg" every single time, so two
 *    genuinely different documents collide constantly. Overwriting the first
 *    one destroys a claim document silently — the claim then gets refused for
 *    a missing paper nobody knows is missing.
 */

/** Keep the name recognisable but safe: no separators, no traversal. */
export function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "documento";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(-120);
  return cleaned || "documento";
}

function split(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  // A leading dot is part of the name, not an extension.
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * First name in the `name`, `name-2`, `name-3`… series that is not already
 * taken. Comparison is case-insensitive: object storage would happily keep
 * `Laudo.pdf` and `laudo.pdf` side by side, and nobody reading the list would
 * be able to tell them apart.
 */
export function freeName(desired: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(desired.toLowerCase())) return desired;

  const { stem, ext } = split(desired);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Nome de arquivo esgotado — renomeie o documento antes de guardar.");
}
