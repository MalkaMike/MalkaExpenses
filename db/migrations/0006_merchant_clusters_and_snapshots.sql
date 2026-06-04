-- 0006_merchant_clusters_and_snapshots.sql
--
-- (a) Move merchant clusters from data/merchant-clusters.json into a real DB
--     table, so the canonical-merchant mapping survives redeploys and is
--     queryable. Each row maps an exact raw description to a cluster key.
-- (b) Weekly resilience snapshots: capture transactions + accounts + categories
--     into immutable JSONB blobs every week. Even if Pluggy disconnects, our
--     cold copy of the world remains intact and re-importable.

-- ── (a) Merchant clusters ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_clusters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description_raw   TEXT        NOT NULL UNIQUE,
  canonical_key     TEXT        NOT NULL,
  canonical_name    TEXT        NOT NULL,
  -- Optional: store the category the admin assigned to this cluster, so syncs
  -- coming back can auto-apply (mirrors merchant_rules but at cluster grain).
  category_id       UUID            REFERENCES categories(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_merchant_clusters_key
  ON merchant_clusters(canonical_key);

CREATE INDEX IF NOT EXISTS ix_merchant_clusters_cat
  ON merchant_clusters(category_id)
  WHERE category_id IS NOT NULL;

ALTER TABLE merchant_clusters ENABLE ROW LEVEL SECURITY;

-- ── (b) Weekly data snapshots ───────────────────────────────────────────────
-- One row per snapshot run. Stores the FULL state of transactions + accounts
-- (plus stats) as JSONB so we can rebuild the world if Supabase data is ever
-- corrupted OR if Pluggy disconnection causes ongoing data loss.
--
-- Storage cost: ~6000 tx × ~500 bytes ≈ 3MB per snapshot × 52 weeks/year =
-- ~150MB/year. Cheap. Worth it.
CREATE TABLE IF NOT EXISTS data_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  week_of          DATE        NOT NULL,           -- Monday of the snapshot week
  transactions     JSONB       NOT NULL,           -- full tx dump
  accounts         JSONB       NOT NULL,           -- account state + balances
  merchant_clusters JSONB,                         -- cluster mapping snapshot
  stats            JSONB       NOT NULL,           -- {tx_count, accounts_count, total_real, total_shared, etc}
  triggered_by     TEXT        NOT NULL DEFAULT 'cron'  -- 'cron' | 'manual' | 'pre-deploy'
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshot_week
  ON data_snapshots(week_of);

CREATE INDEX IF NOT EXISTS ix_snapshot_taken_at
  ON data_snapshots(taken_at DESC);

ALTER TABLE data_snapshots ENABLE ROW LEVEL SECURITY;

-- Cleanup policy: keep all snapshots indefinitely for now. If storage becomes
-- an issue we can compress older-than-1-year snapshots.
