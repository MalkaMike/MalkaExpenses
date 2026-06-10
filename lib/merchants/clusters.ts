import "server-only";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { serverClient } from "@/lib/supabase/server";

// ============================================================================
// Merchant canonical clustering — primary source is the `merchant_clusters`
// Supabase table (durable, queryable, survives redeploys). Falls back to
// data/merchant-clusters.json if the DB table isn't populated yet (migration
// 0006 not applied or pre-seed not run).
//
// Schema: merchant_clusters(description_raw UNIQUE, canonical_key, canonical_name, category_id)
// Used by /admin/merchants pages + bulk-categorize API.
// ============================================================================

export type ClusterEntry = { key: string; name: string };
type ClusterFile = Record<string, ClusterEntry>;

let dbCache: ClusterFile | null = null;
let dbCachedAt = 0;
const DB_CACHE_TTL_MS = 8_000; // 8s TTL — short enough to see merges quickly

let jsonCache: ClusterFile | null = null;

// Track when `primary` (the per-process cache) was loaded. This lets us
// refresh stale data without locking the process on JSON fallback after a
// transient DB failure.
let primaryLoadedAt = 0;
let primarySource: "db" | "json" | null = null;

function loadJsonFallback(): ClusterFile {
  if (jsonCache) return jsonCache;
  const path = join(process.cwd(), "data", "merchant-clusters.json");
  if (!existsSync(path)) {
    jsonCache = {};
    return jsonCache;
  }
  try {
    jsonCache = JSON.parse(readFileSync(path, "utf8")) as ClusterFile;
    return jsonCache;
  } catch {
    jsonCache = {};
    return jsonCache;
  }
}

async function loadFromDb(): Promise<ClusterFile | null> {
  // Cache hit?
  if (dbCache && Date.now() - dbCachedAt < DB_CACHE_TTL_MS) return dbCache;
  try {
    const sb = serverClient();
    const out: ClusterFile = {};
    let off = 0;
    while (true) {
      const { data, error } = await sb
        .from("merchant_clusters")
        .select("description_raw, canonical_key, canonical_name")
        .order("id", { ascending: true })  // stable pagination
        .range(off, off + 999);
      if (error) {
        // Table missing or other error → fall back
        return null;
      }
      if (!data || !data.length) break;
      for (const r of data) {
        out[r.description_raw as string] = {
          key: r.canonical_key as string,
          name: r.canonical_name as string
        };
      }
      if (data.length < 1000) break;
      off += 1000;
    }
    dbCache = out;
    dbCachedAt = Date.now();
    return out;
  } catch {
    return null;
  }
}

// Sync-shaped cache; resolves once async DB load completes.
// First call may return JSON fallback while DB load is in-flight.
let primary: ClusterFile = {};
let primaryLoaded = false;
let inflight: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  // Refresh `primary` when:
  //   - never loaded
  //   - last successful DB load is stale (TTL elapsed)
  //   - last load fell back to JSON (try DB again proactively)
  const stale =
    primaryLoaded &&
    (primarySource === "json" || Date.now() - primaryLoadedAt > DB_CACHE_TTL_MS);
  if (primaryLoaded && !stale) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fromDb = await loadFromDb();
      if (fromDb && Object.keys(fromDb).length > 0) {
        primary = fromDb;
        primarySource = "db";
      } else {
        primary = loadJsonFallback();
        primarySource = "json";
      }
      primaryLoaded = true;
      primaryLoadedAt = Date.now();
    } finally {
      // Always clear inflight so a transient error doesn't permanently park
      // future callers on a dead promise.
      inflight = null;
    }
  })();
  return inflight;
}

/** Preload clusters from DB (with JSON fallback). Call ONCE per request at the
 * top of a server component, then use the sync `clusterFor()` in loops. */
export async function preloadClusters(): Promise<void> {
  await ensureLoaded();
}

/** Async — call from server components without preload. */
export async function clusterForAsync(rawDescription: string): Promise<ClusterEntry> {
  await ensureLoaded();
  return clusterLookup(rawDescription);
}

/** Sync fallback (uses JSON only). Prefer clusterForAsync. */
export function clusterFor(rawDescription: string): ClusterEntry {
  if (!primaryLoaded) {
    // Fire-and-forget warm-up; first call returns JSON, subsequent get DB.
    // A load failure is survivable (JSON fallback keeps working) but must be
    // visible in logs, not swallowed.
    ensureLoaded().catch((e) => {
      console.warn("[clusters] DB cluster load failed, serving JSON fallback:", (e as Error).message);
    });
    return clusterLookup(rawDescription, /*forceJson*/ true);
  }
  return clusterLookup(rawDescription);
}

function clusterLookup(rawDescription: string, forceJson = false): ClusterEntry {
  const source = forceJson ? loadJsonFallback() : primary;

  // 1. Exact match (fast path)
  const hit = source[rawDescription];
  if (hit) return hit;

  // 2. Fuzzy match (only when using the loaded DB source, not JSON fallback)
  if (!forceJson && Object.keys(primary).length > 0) {
    const tokens = tokenize(rawDescription);
    if (tokens.length > 0) {
      let bestScore = 0;
      let bestEntry: ClusterEntry | null = null;
      for (const [desc, entry] of Object.entries(primary)) {
        const score = jaccardSimilarity(tokens, tokenize(desc));
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }
      if (bestScore >= FUZZY_THRESHOLD && bestEntry) {
        return bestEntry;
      }
    }
  }

  // 3. Slug fallback
  const key =
    rawDescription
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "unknown";
  return { key, name: rawDescription };
}

/** Returns ALL raw descriptions that map to a given canonical key.
 * Uses the in-memory cache — good for bulk lookups across many keys.
 * For single-key lookups (e.g. merchant detail page), prefer
 * rawDescriptionsForKeyDirect() which always queries the DB directly and
 * is immune to cross-instance cache invalidation failures on Vercel. */
export async function rawDescriptionsForKey(key: string): Promise<string[]> {
  await ensureLoaded();
  const out: string[] = [];
  for (const [raw, c] of Object.entries(primary)) {
    if (c.key === key) out.push(raw);
  }
  return out;
}

/** Always queries the DB directly — immune to stale in-memory cache.
 * Use this wherever freshness matters: merchant detail page, post-merge
 * redirects, any place that needs to see the result of a recent write. */
export async function rawDescriptionsForKeyDirect(key: string): Promise<string[]> {
  const sb = serverClient();
  const out: string[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("merchant_clusters")
      .select("description_raw")
      .eq("canonical_key", key)
      .range(off, off + 999);
    if (error || !data || !data.length) break;
    out.push(...(data as { description_raw: string }[]).map((r) => r.description_raw));
    if (data.length < 1000) break;
    off += 1000;
  }
  return out;
}

// ─── AI fuzzy auto-clustering ────────────────────────────────────────────────
//
// When a new transaction description doesn't exactly match anything in
// merchant_clusters, we try to find a similar existing cluster automatically.
//
// Algorithm: token-based Jaccard similarity
//   1. Strip legal suffixes (LTDA, SA, ME, EIRELI…) and punctuation
//   2. Tokenise into words ≥ 3 chars
//   3. For each existing description in the cluster cache, compute Jaccard
//      similarity (intersection / union of token sets)
//   4. If best score ≥ FUZZY_THRESHOLD, return that cluster entry
//
// Used in:
//  - clusterLookup (fallback before slug-generation)
//  - suggestClusterForDescription (explicit call from inbox/accept flow)
// ─────────────────────────────────────────────────────────────────────────────

const FUZZY_THRESHOLD = 0.5; // ≥ 50% token overlap → same merchant

// Legal entity suffixes + geo abbreviations common in Brazilian bank descriptions
const LEGAL_SUFFIX_RE =
  /\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|SS|SRL|CIA|INC|LLC|CORP|FILIAL|MATRIZ|UNID|LOJA|RJ|SP|MG|PR|RS|SC|BA|CE|GO|PE|AM|PA|DF)\b/g;

// Brazilian banking noise words — present in many transactions but tell us
// nothing about WHO got paid. Strip them so the merchant name dominates.
const NOISE_TOKENS = new Set([
  "PIX", "PIXQR", "QRS", "QRD", "QRDIN", "CODE", "CODIGO",
  "PAGAMENTO", "PAGTO", "PG", "PAG",
  "TRANSF", "TRANSFERENCIA", "TRF",
  "TED", "DOC", "DEB", "DEBITO", "CRED", "CREDITO",
  "BOLETO", "COMPRA", "SAQUE", "DEPOSITO", "DEP",
  "FATURA", "AUT", "AUTOMATICO",
  "DE", "DA", "DO", "DAS", "DOS", "PARA", "PRA",
  "REF", "REFERENTE", "VENDA"
]);

// Months in PT-BR — appear in PIX descriptions like "MENSALIDADE JANEIRO"
const MONTHS = new Set([
  "JANEIRO", "FEVEREIRO", "MARCO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"
]);

function tokenize(s: string): string[] {
  return s
    .toUpperCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    // Split letter-digit boundaries so "SLEEP03/05" becomes "SLEEP 03 05"
    // (otherwise the day-of-month contaminates the merchant name token)
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    // Keep only words ≥ 3 chars that contain at least one letter — drops
    // pure-digit tokens like "03", "05", "2026", credit-card last-4s, etc.
    .filter((t) => t.length >= 3 && /[A-Z]/.test(t))
    // Drop bank-protocol noise + month names
    .filter((t) => !NOISE_TOKENS.has(t) && !MONTHS.has(t));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Find the best-matching cluster for a description using token similarity.
 * Returns null if no match exceeds FUZZY_THRESHOLD (0.5).
 * Caller must have called preloadClusters() first. */
export function findFuzzyCluster(rawDescription: string): ClusterEntry | null {
  const tokens = tokenize(rawDescription);
  if (tokens.length === 0) return null;

  let bestScore = 0;
  let bestEntry: ClusterEntry | null = null;

  for (const [desc, entry] of Object.entries(primary)) {
    const score = jaccardSimilarity(tokens, tokenize(desc));
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestScore >= FUZZY_THRESHOLD ? bestEntry : null;
}

/** Auto-cluster a description: exact match → fuzzy match → slug fallback.
 * Exported for use in the accept/inbox flow and Pluggy sync. */
export function clusterForWithFuzzy(rawDescription: string): ClusterEntry & { fuzzy?: boolean } {
  // 1. Exact match
  const exact = primary[rawDescription];
  if (exact) return exact;

  // 2. Fuzzy match
  const fuzzy = findFuzzyCluster(rawDescription);
  if (fuzzy) return { ...fuzzy, fuzzy: true };

  // 3. Slug fallback
  const key =
    rawDescription
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "unknown";
  return { key, name: rawDescription };
}

/** Force re-read from DB on next call (all cache levels). */
export function invalidateCache() {
  dbCache = null;
  dbCachedAt = 0;   // reset TTL so loadFromDb() goes to DB immediately
  jsonCache = null;
  primary = {};
  primaryLoaded = false;
  primaryLoadedAt = 0;
  primarySource = null;
}
