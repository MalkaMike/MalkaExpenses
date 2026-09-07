-- 0051_april_to_stupid_bucket.sql
--
-- Mickael, 2026-09-06: APRIL is the health insurance premium, but he does NOT
-- want it in Family — and explicitly not in Kenlo or Health either. It goes to
-- the 'stupid' bucket, which he has now redefined as "the things I don't want
-- in Family". The bucket logic already treats 'stupid' as exclusive: it wins
-- over health and business, so a charge tagged here lands in exactly one place.
--
-- Note on the premium-vs-claim distinction, which happens to agree with him:
-- 'insurance' (Plano) tracks expenses to be CLAIMED BACK from the health plan.
-- The premium you pay to have the plan is not claimable, so it never belonged
-- under that tag in the first place.
--
-- Only outgoing charges are tagged (real_amount < 0). April also issued
-- CREDITS — "CREDITO APRIL" (R$14.877,03) and "IOF de volta de April"
-- (R$517,10) — which stay untagged, same as every other refund in this
-- ledger. Gross charged since Jan/2026 is R$25.258,55; net of those credits
-- it is roughly R$9.864.
--
-- The 'APRIL' pattern spans more than one merchant_clusters key ("APRIL",
-- "April", "PARC*APRIL"), so the automatic generic-pattern guard would have
-- refused it — overridden deliberately here because Mickael confirmed all of
-- them are the same insurer.
--
-- Also settled in the same conversation, needing no migration:
--   - Óticas Wanny  -> stays Family (no tag)
--   - ONC Point, Brazil Vitamins, Dama Einstein -> stay Family (no tag)

INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'stupid'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0
  AND t.description_raw ILIKE '%APRIL%'
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
VALUES ('APRIL', 'contains', (SELECT id FROM reimbursement_tags WHERE slug = 'stupid'), 0.95)
ON CONFLICT (pattern) DO UPDATE SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id;
