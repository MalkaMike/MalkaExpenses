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

export type PluggyCreditCardMetadata = {
  installmentNumber?: number | null;
  totalInstallments?: number | null;
  totalAmount?: number | null;
  billId?: string | null;
  payeeMCC?: string | null;
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
  status?: "PENDING" | "POSTED" | string | null;
  creditCardMetadata?: PluggyCreditCardMetadata | null;
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

/**
 * Map Pluggy's own transaction category (PT or EN) to a Casa category slug.
 * Pluggy already categorizes every transaction with bank-grade data — using it
 * as a prior lets us skip the LLM for the common cases (big cost cut + often
 * better than a description-only guess). Returns null when unknown → fall back
 * to merchant rules / AI.
 */
export function mapPluggyCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const n = category.toLowerCase();
  if (/transfer|transferê|mesma titularidade|ted|doc\b|pix/.test(n)) return "transferencias";
  if (/cart[aã]o de cr[eé]dito|credit card payment|pagamento de fatura|invoice payment/.test(n))
    return "cartao_pagamento";
  if (/sal[aá]rio|payroll|\bincome\b|\brenda\b|proventos/.test(n)) return "receita";
  if (/supermerc|groceries|grocery/.test(n)) return "mercado";
  if (/restaurant|dining|food and drink|delivery|ifood|bar\b|lanch/.test(n)) return "restaurantes";
  if (/aliment/.test(n)) return "alimentacao";
  if (/combust|\bfuel\b|gas station|posto/.test(n)) return "combustivel";
  if (/transport|mobilidade|uber|ride.?hail|t[aá]xi|estacionamento|pedágio|toll/.test(n))
    return "transporte";
  if (/pharmac|farm[aá]cia|drugstore/.test(n)) return "farmacia";
  if (/health|sa[uú]de|medic|hospital|clinic/.test(n)) return "saude";
  if (/hous|morad|aluguel|\brent\b|condom[ií]nio|utilit|electricity|water bill/.test(n))
    return "moradia";
  if (/leisure|lazer|entertain|cinema|game|streaming/.test(n)) return "lazer";
  if (/travel|viage|hotel|airline|airfare|a[eé]reo|pousada/.test(n)) return "viagens";
  if (/educa|school|tuition|course/.test(n)) return "educacao";
  if (/subscription|assinatura/.test(n)) return "assinaturas";
  if (/software|saas|cloud|technology|tecnolog/.test(n)) return "tecnologia";
  if (/shopping|compras|retail|store|e-?commerce|marketplace/.test(n)) return "compras";
  if (/cloth|vestu|apparel|fashion/.test(n)) return "vestuario";
  if (/\btax\b|imposto|tarifa|\bfee\b|juros|interest|bank charge|encargo/.test(n))
    return "financeiro";
  return null;
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
