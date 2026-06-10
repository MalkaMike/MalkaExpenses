-- ============================================================================
-- 0029_integer_cents.sql — store money as BIGINT centavos
--
-- Motivation: NUMERIC(14,2) relies on decimal precision and can accumulate
-- floating-point drift in JS (Number(r.amount)) at the boundary. BIGINT
-- centavos are exact integers — no drift, no toFixed() hacks.
--
-- Scope: core financial columns only.
--   - transactions: real_amount, shared_amount
--   - accounts: real_starting_balance, shared_starting_balance
--   - budgets: monthly_limit
--
-- Nota-fiscais / health / reimbursement tables stay NUMERIC for now — their
-- amounts flow from external documents (insurance, invoices) and the
-- eligibility engine has complex decimal arithmetic that needs a separate pass.
--
-- Conversion: existing rows are multiplied by 100 and rounded.
-- The bulk_share_merchant RPC parameter p_value is updated to BIGINT.
-- ============================================================================

-- ── 1. transactions ──────────────────────────────────────────────────────────

ALTER TABLE transactions
  ALTER COLUMN real_amount   TYPE BIGINT USING ROUND(real_amount * 100)::BIGINT,
  ALTER COLUMN shared_amount TYPE BIGINT USING ROUND(shared_amount * 100)::BIGINT;

-- ── 2. accounts ──────────────────────────────────────────────────────────────

ALTER TABLE accounts
  ALTER COLUMN real_starting_balance   TYPE BIGINT USING ROUND(real_starting_balance * 100)::BIGINT,
  ALTER COLUMN shared_starting_balance TYPE BIGINT USING ROUND(shared_starting_balance * 100)::BIGINT;

-- ── 3. budgets ───────────────────────────────────────────────────────────────

ALTER TABLE budgets
  ALTER COLUMN monthly_limit TYPE BIGINT USING ROUND(monthly_limit * 100)::BIGINT;

-- ── 4. bulk_share_merchant RPC: p_value must accept BIGINT centavos ──────────
--
-- The previous signature used NUMERIC. After this migration 'set' mode sends
-- centavos (integer), so the parameter type must match.

CREATE OR REPLACE FUNCTION bulk_share_merchant(
  p_canonical_key TEXT,
  p_mode          TEXT,
  p_value         BIGINT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_mode NOT IN ('show', 'hide', 'set') THEN
    RAISE EXCEPTION 'invalid_mode: %', p_mode;
  END IF;

  IF p_mode = 'set' AND p_value IS NULL THEN
    RAISE EXCEPTION 'value_required_for_set';
  END IF;

  UPDATE transactions
  SET shared_amount = CASE
        WHEN p_mode = 'show' THEN real_amount
        WHEN p_mode = 'hide' THEN 0
        WHEN p_mode = 'set'  THEN p_value
      END
  WHERE description_raw IN (
    SELECT description_raw FROM merchant_clusters WHERE canonical_key = p_canonical_key
  );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;
