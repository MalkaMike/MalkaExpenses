-- 0009_admin_modifications.sql
--
-- Dedicated ledger for "what Mickael overrides vs what Ayelet sees".
--
-- Every admin action that affects what the household portal shows is logged
-- here with structured before/after data, so /admin/historico can render a
-- rich review-and-revert UI. This is the "diff log" of the dual ledger.
--
-- We DO have a generic audit_log table (write-only audit trail for security).
-- This new table is purpose-built for the UX: filterable, revertable, with
-- merchant context already resolved at write time.

CREATE TABLE IF NOT EXISTS admin_modifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  action          TEXT NOT NULL,    -- 'hide' | 'show' | 'adjust' | 'rename' | 'category'
  scope           TEXT NOT NULL,    -- 'transaction' | 'merchant'
  -- For scope='transaction': target_id = transactions.id, target_name = description_clean
  -- For scope='merchant':    target_id = canonical_key,   target_name = canonical_name (before rename)
  target_id       TEXT NOT NULL,
  target_name     TEXT NOT NULL,
  -- The field that changed and its before/after values (JSON to support both numbers and strings)
  field           TEXT NOT NULL,    -- 'shared_amount' | 'canonical_name' | 'category_id'
  before_value    JSONB,
  after_value     JSONB,
  -- Aggregate impact (rows touched + R$ delta) — null for per-row scope, populated for bulk
  affected_count  INTEGER NOT NULL DEFAULT 1,
  impact_brl      NUMERIC(14, 2),
  -- For bulk operations on a merchant, snapshot the affected transaction ids so we can
  -- revert with surgical precision later. NULL for single-tx scope (target_id IS the tx id).
  affected_ids    UUID[],
  -- Optional notes Mickael might add later via the UI
  notes           TEXT,
  -- Soft revert: if reverted, populate this with a pointer to the new modification row that undid this one
  reverted_by     UUID REFERENCES admin_modifications(id) ON DELETE SET NULL,
  reverted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_admin_mod_created_at
  ON admin_modifications(created_at DESC);

CREATE INDEX IF NOT EXISTS ix_admin_mod_scope_target
  ON admin_modifications(scope, target_id);

CREATE INDEX IF NOT EXISTS ix_admin_mod_action
  ON admin_modifications(action);

CREATE INDEX IF NOT EXISTS ix_admin_mod_not_reverted
  ON admin_modifications(created_at DESC)
  WHERE reverted_at IS NULL;

ALTER TABLE admin_modifications ENABLE ROW LEVEL SECURITY;
