-- 0046_remove_overgeneric_backfilled_rules.sql
--
-- 0045's "unambiguous by tag" backfill missed a second way a 3-word pattern
-- can be dangerous: not shared across DIFFERENT tags (which it correctly
-- skips), but generic enough to match many DIFFERENT, unrelated suppliers
-- that just happen to all carry the SAME tag today.
--
-- Measured on production before removing:
--   'Pagamento de boleto' → 69 transactions, 22 distinct suppliers (school
--     tuition to Hebraica/Anglo, condo, etc. — almost none of them health).
--     0045 tagged it 'insurance' only because the *few* boletos someone had
--     tagged Plano so far all happened to start with those exact words.
--   'Pix enviado D' → 12 transactions, 6 distinct recipients (matches ANY
--     Pix to a name starting with D).
--   'Pix enviado R' → 8 transactions, 6 distinct recipients (same, letter R).
--
-- Left live, the next school-tuition boleto or the next Pix to an unrelated
-- "D"/"R" name would auto-tag as Plano and hide from the shared ledger —
-- exactly the wrong-labeling this whole feature exists to prevent. All three
-- were pure backfill inserts (category_id AND created_from_transaction_id
-- both null — verified before this migration was written), so removing the
-- row outright is safe: nothing else depends on them.

DELETE FROM merchant_rules
WHERE pattern IN ('Pagamento de boleto', 'Pix enviado D', 'Pix enviado R')
  AND category_id IS NULL
  AND created_from_transaction_id IS NULL;
