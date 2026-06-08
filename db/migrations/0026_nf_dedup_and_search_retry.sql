-- ============================================================================
-- 0026_nf_dedup_and_search_retry.sql
--
-- Two safety nets for the nota-fiscal / Gmail-search pipeline.
--
-- (1) Dedup guards on nota_fiscais
--     Today the only INSERT path is scripts/import_nfse_portal.py, which dedups
--     by file_name. But once Gmail auto-creates NF rows, the natural key is the
--     gmail_message_id (one NF per email) and the real-world identity is
--     (nf_number, provider_cnpj). Partial UNIQUE indexes make a duplicate
--     physically impossible without breaking the file_name-keyed importer
--     (its rows have NULL gmail_message_id, so the partial index ignores them).
--     Verified live before adding: 0 duplicates on either key.
--
-- (2) Retry support on transactions
--     The search marks gmail_searched_at even when the Gmail call ERRORED, so a
--     transient failure was indistinguishable from a genuine "no receipt found"
--     and never retried. We now record the error + an attempt counter so a
--     bounded retry pass can re-search ONLY the ones that errored (≤3 tries),
--     while the no-loop guarantee for genuine 0-match rows is preserved.
-- ============================================================================

-- (1) nota_fiscais dedup guards ---------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS nf_gmail_message_id_unique
  ON nota_fiscais (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nf_number_provider_unique
  ON nota_fiscais (nf_number, provider_cnpj)
  WHERE provider_cnpj IS NOT NULL;

-- (2) transactions: separate "searched, nothing found" from "search errored" -
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gmail_search_error text;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gmail_search_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN transactions.gmail_search_error IS
  'Last Gmail-search error for this transaction (NULL = clean / genuine 0-match).
   Non-NULL rows are eligible for the bounded retry pass in the daily cron.';

COMMENT ON COLUMN transactions.gmail_search_attempts IS
  'How many times Gmail search has been attempted. Retry pass stops at 3 to
   avoid looping on permanently-failing rows.';

-- Partial index so the retry pass selects errored rows cheaply.
CREATE INDEX IF NOT EXISTS tx_gmail_search_error_idx
  ON transactions (gmail_search_attempts)
  WHERE gmail_search_error IS NOT NULL;
