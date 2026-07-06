-- ============================================================================
-- 0035_perf_aggregates_and_hardening.sql
--
-- WHY (2026-07-06 full perf/DB audit):
--   PostgREST caps every REST response at max_rows = 1000 (verified live).
--   The ledger has 6,646 transactions (5,645 non-fake). Every place that did
--   "fetch all rows, sum in JS" — account balances, home-page net worth,
--   /months history, missing-month alerts — was silently summing an arbitrary
--   ≤1000-row subset. Wrong numbers, no error.
--
-- FIX: move the sums into Postgres. Views for the anon (household) path,
--   SECURITY DEFINER functions for the admin path. The app now receives
--   pre-aggregated, correct numbers in one small round-trip.
--
-- ALSO (found in passing, verified live via pg_proc.proacl):
--   All four mutation RPCs were executable by `anon` — and the anon key is
--   public (NEXT_PUBLIC, shipped in the browser bundle). Anyone could call
--   reset_all_visibility() or bulk_share_merchant() without auth. Revoked.
--
-- INDEXES: transactions.description_raw is the hottest filter in the app
--   (every merchant hide/show/categorize/merge does WHERE description_raw
--   IN (...)) and had no usable index — every click was a full-table scan.
-- ============================================================================

-- ── 1. Aggregate views for the shared (household/anon) path ─────────────────
-- Both read only shared_transactions_v, which already excludes real_amount,
-- is_fake, notes_private and hidden rows. Sums of visible shared amounts only.

CREATE OR REPLACE VIEW shared_account_balances_v AS
SELECT
  account_id,
  COALESCE(SUM(amount), 0)::BIGINT AS total
FROM shared_transactions_v
GROUP BY account_id;

GRANT SELECT ON shared_account_balances_v TO anon;

CREATE OR REPLACE VIEW shared_monthly_summary_v AS
SELECT
  TO_CHAR(date, 'YYYY-MM') AS month,
  COALESCE(SUM(amount)  FILTER (WHERE amount > 0), 0)::BIGINT AS income,
  COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0)::BIGINT AS expense
FROM shared_transactions_v
WHERE is_transfer = FALSE
GROUP BY 1;

GRANT SELECT ON shared_monthly_summary_v TO anon;

-- ── 2. Admin aggregate functions (service_role only) ────────────────────────

-- Per-account transaction sums.
--   real_total        — SUM(real_amount)   over is_fake = FALSE (admin ledger)
--   shared_total      — SUM(shared_amount) over is_fake = FALSE (admin pages)
--   shared_total_view — SUM(shared_amount) over ALL rows (= shared-view
--                       semantics: fake rows included, zeros contribute 0)
CREATE OR REPLACE FUNCTION account_tx_sums()
RETURNS TABLE(
  account_id        UUID,
  real_total        BIGINT,
  shared_total      BIGINT,
  shared_total_view BIGINT
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.account_id,
    COALESCE(SUM(t.real_amount)   FILTER (WHERE NOT t.is_fake), 0)::BIGINT,
    COALESCE(SUM(t.shared_amount) FILTER (WHERE NOT t.is_fake), 0)::BIGINT,
    COALESCE(SUM(t.shared_amount), 0)::BIGINT
  FROM transactions t
  GROUP BY t.account_id
$$;

REVOKE EXECUTE ON FUNCTION account_tx_sums() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION account_tx_sums() TO service_role;

-- Per-month income/expense over the full history (admin ledger).
-- Same filters the pages used: is_fake = FALSE, is_transfer = FALSE.
CREATE OR REPLACE FUNCTION admin_monthly_summary()
RETURNS TABLE(
  month          TEXT,
  shared_income  BIGINT,
  shared_expense BIGINT,
  real_income    BIGINT,
  real_expense   BIGINT
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    TO_CHAR(t.date, 'YYYY-MM'),
    COALESCE(SUM(t.shared_amount)  FILTER (WHERE t.shared_amount > 0), 0)::BIGINT,
    COALESCE(SUM(-t.shared_amount) FILTER (WHERE t.shared_amount < 0), 0)::BIGINT,
    COALESCE(SUM(t.real_amount)    FILTER (WHERE t.real_amount > 0), 0)::BIGINT,
    COALESCE(SUM(-t.real_amount)   FILTER (WHERE t.real_amount < 0), 0)::BIGINT
  FROM transactions t
  WHERE t.is_fake = FALSE AND t.is_transfer = FALSE
  GROUP BY 1
  ORDER BY 1 DESC
$$;

REVOKE EXECUTE ON FUNCTION admin_monthly_summary() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_monthly_summary() TO service_role;

-- Distinct (account, month) pairs — feeds the missing-month gap detector,
-- which previously fetched every transaction's date (truncated at 1000 oldest
-- rows → recent months looked like gaps).
CREATE OR REPLACE FUNCTION account_month_presence()
RETURNS TABLE(account_id UUID, month TEXT)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.account_id, TO_CHAR(t.date, 'YYYY-MM')
  FROM transactions t
$$;

REVOKE EXECUTE ON FUNCTION account_month_presence() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION account_month_presence() TO service_role;

-- ── 3. Harden existing mutation RPCs (security fix) ─────────────────────────
-- proacl showed anon=X on all four. The app only ever calls them through
-- serverClient() (service_role), so nothing legitimate breaks.

REVOKE EXECUTE ON FUNCTION bulk_share_merchant(TEXT, TEXT, BIGINT, TEXT)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION bulk_share_merchant(TEXT, TEXT, BIGINT, TEXT)      TO service_role;

REVOKE EXECUTE ON FUNCTION bulk_categorize_merchant(TEXT, UUID, BOOLEAN)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION bulk_categorize_merchant(TEXT, UUID, BOOLEAN)      TO service_role;

REVOKE EXECUTE ON FUNCTION apply_transaction_patch(UUID, JSONB, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_transaction_patch(UUID, JSONB, BIGINT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION reset_all_visibility()                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reset_all_visibility()                             TO service_role;

-- ── 4. Indexes for the hottest query shapes ─────────────────────────────────

-- Every merchant action (hide/show/categorize/merge/tag) filters transactions
-- by description_raw; the only existing index has the wrong leading columns.
CREATE INDEX IF NOT EXISTS ix_tx_description_raw ON transactions (description_raw);

-- Date-range scans without account_id (budgets, insights, health scan window).
CREATE INDEX IF NOT EXISTS ix_tx_date_not_fake ON transactions (date DESC) WHERE is_fake = FALSE;

-- Category delete-guard count + category grouping.
CREATE INDEX IF NOT EXISTS ix_tx_category ON transactions (category_id) WHERE category_id IS NOT NULL;
