import "server-only";
import {
  type PluggyItem,
  type PluggyAccount,
  type PluggyTransaction
} from "@/lib/pluggy/mappers";

// Pure mappers + types live in ./mappers (unit-testable, no server-only).
// Re-exported here so existing imports from "@/lib/pluggy/client" keep working.
export {
  signedAmount,
  mapAccountType,
  mapBankKey,
  type PluggyConnector,
  type PluggyItem,
  type PluggyAccount,
  type PluggyTransaction
} from "@/lib/pluggy/mappers";

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

type Paged<T> = { results: T[]; total: number; totalPages: number; page: number };

// ── Enrichment API (separate base URL) ──────────────────────────────────────
const PLUGGY_ENRICH_BASE = "https://enrichment-api.pluggy.ai";

export type PluggyEnrichedTransaction = {
  id: string;
  category: string | null;
  merchant: {
    name: string | null;
    businessName: string | null;
    cnpj: string | null;
  } | null;
};

// ── API surface ──────────────────────────────────────────────────────────────

/**
 * Enrich up to 5000 transactions via Pluggy's Enrichment API.
 * Returns cleaned merchant name + standardized category per transaction.
 * Uses a different base URL (enrichment-api.pluggy.ai) but the same API key.
 */
export async function enrichTransactions(
  transactions: Array<{ id: string; amount: number; date: string; description: string }>,
  opts?: { accountType?: "CHECKING" | "CREDIT_CARD" }
): Promise<PluggyEnrichedTransaction[]> {
  if (transactions.length === 0) return [];
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_ENRICH_BASE}/categorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      transactions,
      accountType: opts?.accountType ?? "CHECKING",
      isBusiness: false
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pluggy enrich failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { results: PluggyEnrichedTransaction[] };
  return json.results ?? [];
}

export type RecurringPayment = {
  description: string;
  averageAmount: number;
  occurrences: string[];
  regularityScore: number;
};

/**
 * Detect recurring payments (subscriptions, bills) for a Pluggy item.
 * Returns patterns that appeared ≥3× with ≤10% amount variance and ~monthly cadence.
 */
export async function getRecurringPayments(itemId: string): Promise<RecurringPayment[]> {
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_ENRICH_BASE}/recurring-payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ itemId })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pluggy recurring-payments failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { recurringPayments: RecurringPayment[] };
  return json.recurringPayments ?? [];
}

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
  const pageSize = 500;
  let page = 1;
  // Hard page cap to avoid runaway loops on a misbehaving connector.
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams({
      accountId,
      from,
      pageSize: String(pageSize),
      page: String(page)
    });
    const json = await authedFetch<Paged<PluggyTransaction>>(`/transactions?${qs}`);
    const results = json.results ?? [];
    out.push(...results);
    // Stop on a short page (skill-recommended) or when we've hit totalPages.
    if (results.length < pageSize) break;
    if (json.totalPages && page >= json.totalPages) break;
    page += 1;
  }
  return out;
}
