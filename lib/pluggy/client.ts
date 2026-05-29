import "server-only";

// Minimal typed REST client for the Pluggy Open Finance API.
// We use raw fetch (no SDK) to keep the surface small and fully typed.
// Auth: POST /auth with clientId+secret → apiKey (valid ~2h), cached in-process.
// Docs: https://docs.pluggy.ai

const PLUGGY_BASE = "https://api.pluggy.ai";

export class PluggyConfigError extends Error {}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new PluggyConfigError(
      "PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET not set — add them to the environment to enable Open Finance sync."
    );
  }
  return { clientId, clientSecret };
}

// ── API key cache (per server instance) ──────────────────────────────────────
let cachedKey: { key: string; expiresAt: number } | null = null;

async function getApiKey(): Promise<string> {
  if (cachedKey && cachedKey.expiresAt > Date.now() + 60_000) {
    return cachedKey.key;
  }
  const { clientId, clientSecret } = credentials();
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pluggy auth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { apiKey: string };
  // apiKey is valid ~2h; refresh a bit early.
  cachedKey = { key: json.apiKey, expiresAt: Date.now() + 110 * 60_000 };
  return json.apiKey;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pluggy ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ── Types (only the fields we consume) ───────────────────────────────────────
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

type Paged<T> = { results: T[]; total: number; totalPages: number; page: number };

// ── API surface ──────────────────────────────────────────────────────────────

/** Short-lived token the front-end Connect widget needs. */
export async function createConnectToken(options?: {
  itemId?: string; // pass to re-authenticate / update an existing item
  clientUserId?: string;
}): Promise<string> {
  const json = await authedFetch<{ accessToken: string }>("/connect_token", {
    method: "POST",
    body: JSON.stringify(options ?? {})
  });
  return json.accessToken;
}

export async function getItem(itemId: string): Promise<PluggyItem> {
  return authedFetch<PluggyItem>(`/items/${itemId}`);
}

export async function listAccounts(itemId: string): Promise<PluggyAccount[]> {
  const json = await authedFetch<Paged<PluggyAccount>>(
    `/accounts?itemId=${encodeURIComponent(itemId)}`
  );
  return json.results ?? [];
}

/** Pull all transactions for an account since `from` (YYYY-MM-DD), paginating. */
export async function listTransactions(
  accountId: string,
  from: string
): Promise<PluggyTransaction[]> {
  const out: PluggyTransaction[] = [];
  let page = 1;
  // Hard page cap to avoid runaway loops on a misbehaving connector.
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams({
      accountId,
      from,
      pageSize: "500",
      page: String(page)
    });
    const json = await authedFetch<Paged<PluggyTransaction>>(`/transactions?${qs}`);
    out.push(...(json.results ?? []));
    if (page >= (json.totalPages ?? 1)) break;
    page += 1;
  }
  return out;
}

/** Pluggy amount → signed value (expense negative, income positive). */
export function signedAmount(tx: PluggyTransaction): number {
  const abs = Math.abs(tx.amount);
  if (tx.type === "DEBIT") return -abs;
  if (tx.type === "CREDIT") return abs;
  // No type hint: trust the sign Pluggy already provided.
  return tx.amount;
}

/** Map a Pluggy account type to a Casa account_type. */
export function mapAccountType(t: string): "checking" | "savings" | "credit_card" {
  if (t === "CREDIT") return "credit_card";
  if (t === "SAVINGS") return "savings";
  return "checking";
}

/** Best-effort connector name → Casa bank key used by BankSquare/brand colors. */
export function mapBankKey(connectorName: string): string {
  const n = connectorName.toLowerCase();
  if (n.includes("ita")) return "itau";
  if (n.includes("bradesco")) return "bradesco";
  if (n.includes("santander")) return "santander";
  if (n.includes("nubank") || n.includes("nu ")) return "nubank";
  if (n.includes("inter")) return "inter";
  if (n.includes("btg")) return "btg";
  if (n.includes("c6")) return "c6";
  return "outro";
}
