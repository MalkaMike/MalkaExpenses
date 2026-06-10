-- ============================================================================
-- 0030_transactional_rpcs.sql — atomic update + audit-log RPCs
--
-- Problem: PATCH /api/transactions/[id] and /api/admin/merchants/share both
-- did multi-step DB sequences in TypeScript: SELECT → UPDATE → INSERT audit.
-- If the audit INSERT failed after the UPDATE committed, the modification log
-- was silently missing. Since both operations are always meant to be a unit,
-- moving them into stored procedures gives Postgres-level atomicity: either
-- the UPDATE + admin_modifications INSERT both commit, or neither does.
--
-- Two RPCs:
--
--   apply_transaction_patch(p_id, p_patch, p_old_shared, p_target_name)
--     Applies an arbitrary JSON patch to a transaction row, then atomically
--     appends to admin_modifications if shared_amount changed.
--
--   bulk_share_merchant(p_canonical_key, p_mode, p_value, p_merchant_name)
--     Replaces the old INTEGER-returning version. Now reads its own
--     before-state, applies the bulk UPDATE, reads after-state, and
--     atomically inserts admin_modifications when p_merchant_name is given.
--     Returns JSONB {updated: int, impact_brl: numeric}.
--
-- The old 3-parameter bulk_share_merchant(TEXT, TEXT, BIGINT) is dropped
-- because its return type (INTEGER) cannot be changed in-place — Postgres
-- requires DROP + CREATE to change a function's return type.
-- ============================================================================

-- ── 1. apply_transaction_patch ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_transaction_patch(
  p_id          UUID,
  p_patch       JSONB,    -- keys: shared_amount, real_amount, category_id,
                          --        description_clean, is_transfer, is_fake,
                          --        notes_private, status
  p_old_shared  BIGINT,   -- existing.shared_amount (centavos) — used for the
                          -- audit before-value; caller already holds this
  p_target_name TEXT      -- description for the admin_modifications row
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         JSONB;
  v_new_shared  BIGINT;
  v_real_amount BIGINT;
  v_action      TEXT;
BEGIN
  -- Apply the patch. Each column is updated only if the key is present in
  -- p_patch. JSON null for nullable columns (category_id, notes_private)
  -- correctly propagates as SQL NULL via ->>'key'::type = NULL.
  UPDATE transactions SET
    shared_amount     = CASE WHEN p_patch ? 'shared_amount'
                             THEN (p_patch->>'shared_amount')::BIGINT
                             ELSE shared_amount END,
    real_amount       = CASE WHEN p_patch ? 'real_amount'
                             THEN (p_patch->>'real_amount')::BIGINT
                             ELSE real_amount END,
    category_id       = CASE WHEN p_patch ? 'category_id'
                             THEN (p_patch->>'category_id')::UUID
                             ELSE category_id END,
    description_clean = CASE WHEN p_patch ? 'description_clean'
                             THEN p_patch->>'description_clean'
                             ELSE description_clean END,
    is_transfer       = CASE WHEN p_patch ? 'is_transfer'
                             THEN (p_patch->>'is_transfer')::BOOLEAN
                             ELSE is_transfer END,
    is_fake           = CASE WHEN p_patch ? 'is_fake'
                             THEN (p_patch->>'is_fake')::BOOLEAN
                             ELSE is_fake END,
    notes_private     = CASE WHEN p_patch ? 'notes_private'
                             THEN p_patch->>'notes_private'
                             ELSE notes_private END,
    status            = CASE WHEN p_patch ? 'status'
                             THEN p_patch->>'status'
                             ELSE status END
  WHERE id = p_id
  RETURNING to_jsonb(transactions.*) INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction_not_found: %', p_id;
  END IF;

  -- Atomically append to admin_modifications when shared_amount changed
  IF p_patch ? 'shared_amount' THEN
    v_new_shared  := (p_patch->>'shared_amount')::BIGINT;
    IF v_new_shared IS DISTINCT FROM p_old_shared THEN
      v_real_amount := (v_row->>'real_amount')::BIGINT;
      v_action := CASE
        WHEN v_new_shared = 0              THEN 'hide'
        WHEN v_new_shared = v_real_amount  THEN 'show'
        ELSE 'adjust'
      END;
      INSERT INTO admin_modifications (
        action, scope, target_id, target_name, field,
        before_value, after_value, affected_count, impact_brl
      ) VALUES (
        v_action, 'transaction', p_id::TEXT,
        LEFT(p_target_name, 200), 'shared_amount',
        jsonb_build_object('value', p_old_shared::float8 / 100),
        jsonb_build_object('value', v_new_shared::float8 / 100),
        1,
        (v_new_shared - p_old_shared)::float8 / 100
      );
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- ── 2. Replace bulk_share_merchant ──────────────────────────────────────────
--
-- The 0029 version returned INTEGER. Dropping before re-creating because
-- Postgres does not allow changing a function's return type in-place.

DROP FUNCTION IF EXISTS bulk_share_merchant(TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION bulk_share_merchant(
  p_canonical_key  TEXT,
  p_mode           TEXT,
  p_value          BIGINT  DEFAULT NULL,
  p_merchant_name  TEXT    DEFAULT NULL  -- when set, also writes admin_modifications
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated      INTEGER;
  v_total_before BIGINT   := 0;
  v_total_after  BIGINT   := 0;
  v_row_count    INTEGER  := 0;
  v_ids          UUID[];
  v_impact_brl   float8   := 0;
BEGIN
  IF p_mode NOT IN ('show', 'hide', 'set') THEN
    RAISE EXCEPTION 'invalid_mode: %', p_mode;
  END IF;

  IF p_mode = 'set' AND p_value IS NULL THEN
    RAISE EXCEPTION 'value_required_for_set';
  END IF;

  -- Read before-state only when we'll need to write an audit row
  IF p_merchant_name IS NOT NULL THEN
    SELECT
      COALESCE(SUM(t.shared_amount), 0),
      COUNT(t.id)::INTEGER,
      ARRAY_AGG(t.id)
    INTO v_total_before, v_row_count, v_ids
    FROM transactions t
    WHERE t.description_raw IN (
      SELECT mc.description_raw
      FROM merchant_clusters mc
      WHERE mc.canonical_key = p_canonical_key
    );
  END IF;

  -- Bulk update
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

  -- Atomically write admin_modifications
  IF p_merchant_name IS NOT NULL AND v_updated > 0 THEN
    SELECT COALESCE(SUM(t.shared_amount), 0)
    INTO v_total_after
    FROM transactions t
    WHERE t.id = ANY(v_ids);

    v_impact_brl := (v_total_after - v_total_before)::float8 / 100;

    INSERT INTO admin_modifications (
      action, scope, target_id, target_name, field,
      before_value, after_value, affected_count, impact_brl, affected_ids
    ) VALUES (
      CASE p_mode WHEN 'set' THEN 'adjust' ELSE p_mode END,
      'merchant', p_canonical_key, p_merchant_name, 'shared_amount',
      jsonb_build_object(
        'total', v_total_before::float8 / 100,
        'rows',  COALESCE(v_row_count, v_updated)
      ),
      CASE p_mode
        WHEN 'set' THEN jsonb_build_object(
          'total',         v_total_after::float8 / 100,
          'per_row_value', p_value::float8 / 100,
          'rows',          COALESCE(v_row_count, v_updated)
        )
        ELSE jsonb_build_object(
          'total', v_total_after::float8 / 100,
          'rows',  COALESCE(v_row_count, v_updated)
        )
      END,
      v_updated,
      v_impact_brl,
      v_ids
    );
  END IF;

  RETURN jsonb_build_object(
    'updated',    v_updated,
    'impact_brl', v_impact_brl
  );
END;
$$;
