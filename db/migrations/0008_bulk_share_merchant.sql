-- 0008_bulk_share_merchant.sql
-- Atomic bulk update of shared_amount across all transactions of a merchant
-- cluster. Used by /admin/merchants/[key] to control what the household sees
-- for an entire merchant in one click.
--
-- Modes:
--   'show' → shared_amount = real_amount (household sees the real value)
--   'hide' → shared_amount = 0           (household sees nothing — filtered
--                                          by the shared_transactions_v view)
--   'set'  → shared_amount = p_value     (custom value applied to every tx)

CREATE OR REPLACE FUNCTION bulk_share_merchant(
  p_canonical_key TEXT,
  p_mode TEXT,
  p_value NUMERIC DEFAULT NULL
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

  -- Apply to every transaction whose raw description belongs to the cluster
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
