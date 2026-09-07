-- 0045_backfill_reimbursement_merchant_rules.sql
--
-- 0044 gave merchant_rules a reimbursement_tag_id, and lib/pluggy/sync.ts now
-- applies it on every new sync — but only rules created FROM NOW ON. The 392
-- transactions already tagged Kenlo/Laik/Plano (via the old /tag endpoint,
-- before 0044) never got a rule written for them, so without this backfill
-- the exact suppliers Mickael already labelled would still need re-tagging
-- by hand on their next charge — the one thing this whole feature exists to
-- stop.
--
-- One-time, idempotent (ON CONFLICT ... WHERE reimbursement_tag_id IS NULL —
-- safe to re-run, never overwrites a rule someone already set by hand).
--
-- Skips any 3-word pattern shared by transactions tagged with MORE THAN ONE
-- tag (HAVING COUNT(DISTINCT tag_id) = 1) — e.g. "Pagamento de Pix" (too
-- generic, matches unrelated payments) and "MANUS AI" (genuinely split
-- Kenlo/Laik, per 0010's own "business meal partially expensed to both"
-- case). Those stay manual on purpose rather than guess wrong.

WITH desc_tags AS (
  SELECT DISTINCT t.description_raw, tr.tag_id
  FROM transaction_reimbursements tr
  JOIN transactions t ON t.id = tr.transaction_id
),
patterned AS (
  SELECT
    array_to_string((regexp_split_to_array(trim(description_raw), '\s+'))[1:3], ' ') AS pattern,
    tag_id
  FROM desc_tags
  WHERE length(trim(description_raw)) > 0
),
unambiguous AS (
  -- MIN/MAX don't exist for uuid; HAVING already guarantees exactly one
  -- distinct value, so array_agg(DISTINCT ...)[1] is that single value.
  SELECT pattern, (array_agg(DISTINCT tag_id))[1] AS tag_id
  FROM patterned
  WHERE length(pattern) >= 3
  GROUP BY pattern
  HAVING COUNT(DISTINCT tag_id) = 1
)
INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT pattern, 'contains', tag_id, 0.95
FROM unambiguous
ON CONFLICT (pattern) DO UPDATE
  SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id
  WHERE merchant_rules.reimbursement_tag_id IS NULL;
