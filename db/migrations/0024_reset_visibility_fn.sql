-- Migration 0024: reset_all_visibility() RPC
--
-- A single-query bulk update that sets shared_amount = real_amount
-- for all non-fake transactions, and moves pending_review → user_edited.
-- Called by POST /api/admin/reset-visibility.
-- Returns the number of rows updated.

CREATE OR REPLACE FUNCTION reset_all_visibility()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE transactions
  SET
    shared_amount = real_amount,
    status = CASE
      WHEN status = 'pending_review' THEN 'user_edited'
      ELSE status
    END
  WHERE
    is_fake = false
    AND shared_amount IS DISTINCT FROM real_amount;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION reset_all_visibility() IS
  'One-time admin op: sets shared_amount = real_amount for all non-fake transactions. Returns affected count.';
