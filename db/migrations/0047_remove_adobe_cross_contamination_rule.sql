-- 0047_remove_adobe_cross_contamination_rule.sql
--
-- Follow-up audit after 0046 found a second overgeneric rule 0045's backfill
-- created: pattern 'ADOBE' (tag: kenlo). Checked on production —
-- merchant_clusters shows it matches BOTH the real Adobe subscription
-- (canonical_key 'adobe') AND an unrelated merchant, 'Banca do Bento'
-- (canonical_key 'banca_do_bento') — a coincidental substring hit, not the
-- same company. Left live, a future Banca do Bento charge would auto-tag
-- Kenlo and vanish from the shared ledger.
--
-- The more specific Adobe billing-descriptor patterns from the same backfill
-- ('EBN *ADOBE', 'EBN*ADOBE') are unaffected and stay — they didn't flag in
-- the audit (specific to Adobe only).
--
-- Same safety condition as 0046: pure backfill insert, nothing depends on it.

DELETE FROM merchant_rules
WHERE pattern = 'ADOBE'
  AND category_id IS NULL
  AND created_from_transaction_id IS NULL;
