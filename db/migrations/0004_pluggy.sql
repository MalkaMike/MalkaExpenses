-- ============================================================================
-- 0004_pluggy.sql — Open Finance (Pluggy) auto-sync
-- ----------------------------------------------------------------------------
-- Adds the ability to connect a bank via Pluggy Open Finance and auto-pull
-- transactions, instead of (or alongside) manual OFX/PDF upload.
--
-- Design intent:
--   - A Pluggy "Item" = one bank login; it can expose several accounts.
--   - Each Pluggy account maps 1:1 to a Casa `accounts` row (carrying the
--     pluggy ids so we can re-sync and update on MFA refresh).
--   - Pluggy transactions dedup on their stable id via transactions.external_id.
--   - Pluggy fills the REAL ledger; shared_amount still curated by the admin,
--     so the dual ledger is unaffected. shared_transactions_v does NOT filter
--     by source, so synced rows appear to the household once shared_amount<>0.
--
-- Apply: paste into the Supabase SQL editor (same as 0001–0003).
-- ============================================================================

-- 1) New transaction source. (ALTER TYPE ... ADD VALUE is idempotent via IF NOT EXISTS)
ALTER TYPE tx_source ADD VALUE IF NOT EXISTS 'pluggy';

-- 2) Link Casa accounts to their Pluggy item/account + track last sync.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pluggy_item_id    TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pluggy_account_id TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pluggy_last_sync  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_accounts_pluggy_item
  ON accounts(pluggy_item_id) WHERE pluggy_item_id IS NOT NULL;

-- 3) DB-level dedup for synced transactions (one row per pluggy transaction id).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_pluggy
  ON transactions(account_id, external_id)
  WHERE source = 'pluggy' AND external_id IS NOT NULL;
