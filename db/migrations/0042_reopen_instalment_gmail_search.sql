-- ============================================================================
-- 0042_reopen_instalment_gmail_search.sql
--
-- Re-open the nota fiscal search for instalment transactions that were searched
-- under the broken logic fixed in d542014.
--
-- Why: until that commit the nightly search had three defects, each fatal on
-- its own for an instalment row:
--   1. it passed real_amount in CENTAVOS to a matcher expecting BRL, so it hunted
--      "R$ 10.780,00" on a R$ 107,80 purchase;
--   2. it centred the date window on the BILLING date, which for instalment N is
--      ~N-1 months after the purchase the receipt belongs to — rows billed in the
--      future searched a future window;
--   3. it looked for the instalment slice, while a receipt quotes the full price.
-- Every affected row was stamped gmail_searched_at, and the cron's Pass 1 selects
-- on `gmail_searched_at IS NULL`, so they would never be retried. The stored 0 is
-- not an answer — it is an unasked question.
--
-- Scope: instalment rows ONLY, detected with the SAME rule as
-- installmentInfoFrom() in lib/gmail/find-receipt-v2.ts — a trailing "(N/M)" or
-- "NN/MM" where M >= 2 and N <= M. The M>=2 / N<=M guard is what keeps dates
-- like "12/05" and one-off "1/1" markers out.
--
-- Restricted further to rows the cron can actually pick up (Pass 1 filters:
-- is_fake = false, is_transfer = false, real_amount < 0) and to rows that found
-- NOTHING — a row that already has a receipt is left completely alone.
--
-- Measured before writing (2026-08-28):
--   1525  loose regex match (includes dates like "12/05" — NOT used)
--   1240  true instalment rows by the code's rule
--   1164  of those already searched
--   1163  of those found nothing
--   1080  of those the cron will actually retry  <- exactly this set
--      1  instalment row already has a receipt   <- untouched
--
-- Reversible: every affected row's prior state is snapshotted first. Rollback is
-- at the bottom of this file.
-- ============================================================================

-- 1. Snapshot the prior state so this is undoable.
CREATE TABLE IF NOT EXISTS gmail_search_reopen_0042 (
  id                    UUID PRIMARY KEY,
  gmail_searched_at     TIMESTAMPTZ,
  gmail_match_count     INTEGER,
  gmail_search_attempts INTEGER,
  gmail_search_error    TEXT,
  snapshotted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH m AS (
  SELECT t.*,
         COALESCE(
           regexp_match(t.description_clean, '\((\d{1,2})/(\d{1,2})\)\s*$'),
           regexp_match(t.description_raw,   '(\d{1,2})/(\d{1,2})\s*$')
         ) AS g
  FROM transactions t
), target AS (
  SELECT * FROM m
  WHERE g IS NOT NULL
    AND (g[2])::int >= 2
    AND (g[1])::int <= (g[2])::int
    AND gmail_searched_at IS NOT NULL
    AND COALESCE(gmail_match_count, 0) = 0
    AND is_fake = false
    AND is_transfer = false
    AND real_amount < 0
)
INSERT INTO gmail_search_reopen_0042
  (id, gmail_searched_at, gmail_match_count, gmail_search_attempts, gmail_search_error)
SELECT id, gmail_searched_at, gmail_match_count, gmail_search_attempts, gmail_search_error
FROM target
ON CONFLICT (id) DO NOTHING;

-- 2. Re-open exactly the snapshotted rows. Attempts reset to 0 because these are
--    fresh searches under new logic, not retries of the old one.
UPDATE transactions t
SET gmail_searched_at     = NULL,
    gmail_search_attempts = 0,
    gmail_search_error    = NULL
FROM gmail_search_reopen_0042 b
WHERE t.id = b.id;

-- ── Rollback (run by hand if needed) ─────────────────────────────────────────
-- UPDATE transactions t
-- SET gmail_searched_at     = b.gmail_searched_at,
--     gmail_match_count     = b.gmail_match_count,
--     gmail_search_attempts = b.gmail_search_attempts,
--     gmail_search_error    = b.gmail_search_error
-- FROM gmail_search_reopen_0042 b
-- WHERE t.id = b.id;
-- DROP TABLE gmail_search_reopen_0042;
