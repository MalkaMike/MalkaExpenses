// Pure Pluggy data mappers + shared types. No I/O, no "server-only", so these
// are unit-testable and safe to import anywhere.

export type PluggyConnector = {
  id: number;
  name: string;
  imageUrl?: string;
  primaryColor?: string;
};

export type PluggyItem = {
  id: string;
  connector: PluggyConnector;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type PluggyAccount = {
  id: string;
  itemId: string;
  type: "BANK" | "CREDIT" | string;
  subtype?: string | null;
  name: string;
  number?: string | null;
  balance: number;
  currencyCode: string;
};

export type PluggyTransaction = {
  id: string;
  accountId: string;
  amount: number;
  date: string; // ISO
  description: string;
  descriptionRaw?: string | null;
  currencyCode?: string;
  category?: string | null;
  categoryId?: string | null;
  type?: "DEBIT" | "CREDIT" | string | null;
};

/** Pluggy amount → signed value (expense negative, income positive). */
export function signedAmount(tx: PluggyTransaction): number {
  const abs = Math.abs(tx.amount);
  if (tx.type === "DEBIT") return -abs;
  if (tx.type === "CREDIT") return abs;
  // No type hint: trust the sign Pluggy already provided.
  return tx.amount;
}

/** Map a Pluggy account type/subtype to a Casa account_type. */
export function mapAccountType(
  t: string,
  subtype?: string | null
): "checking" | "savings" | "credit_card" {
  if (t === "CREDIT") return "credit_card";
  if ((subtype ?? "").toUpperCase().includes("SAVING")) return "savings";
  return "checking";
}

/** Best-effort connector name → Casa bank key used by BankSquare/brand colors. */
export function mapBankKey(connectorName: string): string {
  const n = (connectorName ?? "").toLowerCase();
  if (n.includes("ita")) return "itau";
  if (n.includes("bradesco")) return "bradesco";
  if (n.includes("santander")) return "santander";
  if (n.includes("nubank") || n.includes("nu ")) return "nubank";
  if (n.includes("inter")) return "inter";
  if (n.includes("btg")) return "btg";
  if (n.includes("c6")) return "c6";
  return "outro";
}
