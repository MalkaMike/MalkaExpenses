export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

// Integer with pt-BR thousand separator (e.g. 6011 → "6.011").
// Use everywhere counts/numbers > 999 are displayed.
export function formatInt(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0
  }).format(value);
}

export function formatDate(iso: string): string {
  // YYYY-MM-DD -> DD/MM/YYYY
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function monthLabel(yyyymm: string): string {
  // "2025-03" -> "mar/2025"
  const [y, m] = yyyymm.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${months[Number(m) - 1] ?? m}/${y}`;
}
