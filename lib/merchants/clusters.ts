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
const DB_CACHE_TTL_MS = 60_000; // refresh every minute

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
    // Fire-and-forget; first call returns JSON, subsequent get DB
    ensureLoaded().catch(() => {});
    return clusterLookup(rawDescription, /*forceJson*/ true);
  }
  return clusterLookup(rawDescription);
}

function clusterLookup(rawDescription: string, forceJson = false): ClusterEntry {
  const source = forceJson ? loadJsonFallback() : primary;
  const hit = source[rawDescription];
  if (hit) return hit;
  const key =
    rawDescription
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "unknown";
  return { key, name: rawDescription };
}

/** Returns ALL raw descriptions that map to a given canonical key. */
export async function rawDescriptionsForKey(key: string): Promise<string[]> {
  await ensureLoaded();
  const out: string[] = [];
  for (const [raw, c] of Object.entries(primary)) {
    if (c.key === key) out.push(raw);
  }
  return out;
}

/** Force re-read from DB on next call. */
export function invalidateCache() {
  dbCache = null;
  jsonCache = null;
  primary = {};
  primaryLoaded = false;
  primaryLoadedAt = 0;
  primarySource = null;
}
