-- ============================================================================
-- 0012_gmail_search_state.sql
--
-- Track which transactions have already been searched for receipts.
-- Two new columns on transactions:
--   gmail_searched_at  — timestamp of last search attempt (NULL = never searched)
--   gmail_match_count  — number of matches found (0 = searched but empty)
--
-- This lets the UI distinguish:
--   never searched   → show neutral 📎 icon
--   searched, empty  → show muted "couldn't find" icon (no re-search needed)
--   searched, found  → show colored 📎 with match count
-- ============================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gmail_searched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gmail_match_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS transactions_gmail_unsearched_idx
  ON transactions (date DESC)
  WHERE gmail_searched_at IS NULL;

COMMENT ON COLUMN transactions.gmail_searched_at IS
  'When we last queried Gmail for nota fiscal matches. NULL = never. Set even when no matches found, to avoid re-searching.';
COMMENT ON COLUMN transactions.gmail_match_count IS
  'How many Gmail messages we matched as potential receipts (cached count of transaction_receipts rows).';
