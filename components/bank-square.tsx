// Brand-colored rounded square with the bank's initial — the account avatar
// from the Stitch design (Itaú orange "I", Nubank purple "N", BTG navy "B").

const BANK_BRAND: Record<string, { color: string; initial: string }> = {
  itau: { color: "#EC7000", initial: "I" },
  bradesco: { color: "#CC092F", initial: "B" },
  santander: { color: "#EC0000", initial: "S" },
  nubank: { color: "#8A05BE", initial: "N" },
  inter: { color: "#FF7A00", initial: "I" },
  btg: { color: "#0A2540", initial: "B" },
  c6: { color: "#242424", initial: "C" },
  outro: { color: "#64748b", initial: "•" }
};

export function BankSquare({
  bank,
  size = 40
}: {
  bank: string;
  size?: number;
}) {
  const key = bank?.toLowerCase().trim();
  const brand = BANK_BRAND[key] ?? {
    color: "#64748b",
    initial: (bank?.[0] ?? "•").toUpperCase()
  };
  return (
    <div
      className="inline-flex items-center justify-center rounded-xl shrink-0 font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: brand.color,
        fontSize: size * 0.42
      }}
      aria-hidden
    >
      {brand.initial}
    </div>
  );
}
