-- 0007_security_hardening.sql
--
-- Fixes from Codex review:
--  (a) login_attempts table for durable rate limiting
--  (b) bulk_categorize_merchant() RPC — atomic bulk categorization
--  (c) merchant_clusters.updated_at trigger
--  (d) data_snapshots: drop UNIQUE on week_of so reruns don't overwrite
--      the last good snapshot (immutable inserts, multiple attempts per week)

-- ── (a) Login attempt tracking (rate limit store) ───────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip            TEXT,
  username      TEXT,
  success       BOOLEAN NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quick lookups for "how many failures in last N minutes by IP/username"
CREATE INDEX IF NOT EXISTS ix_login_attempts_ip_time
  ON login_attempts(ip, attempted_at DESC)
  WHERE success = FALSE;

CREATE INDEX IF NOT EXISTS ix_login_attempts_username_time
  ON login_attempts(username, attempted_at DESC)
  WHERE success = FALSE;

-- Keep table small: drop attempts older than 7 days (cron later if needed)
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- ── (b) Atomic bulk categorization ──────────────────────────────────────────
-- Single transaction: cluster lookup + tx update + cluster metadata sync.
-- Either everything succeeds or nothing does.
CREATE OR REPLACE FUNCTION bulk_categorize_merchant(
  p_canonical_key TEXT,
  p_category_id UUID,
  p_is_transfer BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Verify category exists (fail loud if not)
  PERFORM 1 FROM categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  -- Update all transactions whose raw description belongs to this cluster
  UPDATE transactions
  SET category_id  = p_category_id,
      confidence   = 0.99,
      ai_reasoning = 'Categorizado em massa via página de comerciantes',
      is_transfer  = p_is_transfer
  WHERE description_raw IN (
    SELECT description_raw FROM merchant_clusters WHERE canonical_key = p_canonical_key
  );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Mirror the choice on the cluster row(s) themselves so future syncs auto-apply
  UPDATE merchant_clusters
  SET category_id = p_category_id,
      updated_at  = now()
  WHERE canonical_key = p_canonical_key;

  RETURN v_updated;
END;
$$;

-- ── (c) Trigger to maintain merchant_clusters.updated_at ───────────────────
CREATE OR REPLACE FUNCTION set_updated_at_now()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_clusters_updated_at ON merchant_clusters;
CREATE TRIGGER trg_merchant_clusters_updated_at
BEFORE UPDATE ON merchant_clusters
FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ── (d) Immutable weekly snapshots ──────────────────────────────────────────
-- Drop UNIQUE so reruns append rather than overwrite. The (week_of, taken_at)
-- combo is now naturally unique. Add a non-unique index for fast week lookups.
DROP INDEX IF EXISTS ux_snapshot_week;
CREATE INDEX IF NOT EXISTS ix_snapshot_week ON data_snapshots(week_of);
