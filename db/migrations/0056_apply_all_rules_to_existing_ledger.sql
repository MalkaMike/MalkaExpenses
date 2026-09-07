-- 0056_apply_all_rules_to_existing_ledger.sql
--
-- Mickael, 2026-09-06: "I want everything synced and labelled now."
--
-- Up to here, rules were applied two ways: forward (lib/pluggy/sync.ts, on
-- rows arriving from the bank) and by hand-written patterns in 0049–0055
-- (on rows that already existed). This closes the gap between them: every
-- rule that carries a tag is applied to every matching row already in the
-- ledger, using the SAME matching the sync uses — including pattern_type,
-- which 0045's backfill ignored ('exact' rules like ADOBE only work here).
--
-- Idempotent: ON CONFLICT DO NOTHING on the (transaction_id, tag_id) pair,
-- so re-running changes nothing.
--
-- Transfers are excluded on purpose. A transfer is not spending — it is the
-- card bill being paid or a balance being rolled — so it should not carry a
-- bucket tag. (The Nubank bill payments in 0048 and the overdue rollover in
-- 0054 are exactly these.)
--
-- Both signs ARE included, deliberately and unlike 0049. The live sync does
-- not look at sign either, so this makes the backfill and the future
-- behaviour identical rather than leaving two subtly different rules. The
-- practical effect: money coming IN from Laik and Akiva is recognised as
-- business money instead of sitting in the household's income.
--
-- Second statement: Kenlo/Laik charges are hidden from the shared household
-- ledger (shared_amount = 0), which is what the tag has always meant in this
-- app — see hideOnTag in app/api/admin/merchants/[key]/tag/route.ts.

WITH matches AS (
  SELECT DISTINCT t.id AS transaction_id, mr.reimbursement_tag_id AS tag_id
  FROM merchant_rules mr
  JOIN transactions t ON (
    CASE mr.pattern_type
      WHEN 'exact'       THEN lower(t.description_raw) = lower(mr.pattern)
      WHEN 'starts_with' THEN lower(t.description_raw) LIKE lower(mr.pattern) || '%'
      ELSE position(lower(mr.pattern) in lower(t.description_raw)) > 0
    END
  )
  WHERE mr.reimbursement_tag_id IS NOT NULL
    AND t.is_fake = false
    AND t.is_transfer = false
)
INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT transaction_id, tag_id, 'pending' FROM matches
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

UPDATE transactions t
SET shared_amount = 0
FROM transaction_reimbursements tr
JOIN reimbursement_tags rt ON rt.id = tr.tag_id
WHERE tr.transaction_id = t.id
  AND rt.slug IN ('kenlo', 'laik')
  AND t.shared_amount <> 0;
