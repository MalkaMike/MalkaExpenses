-- 0052_april_credits_to_stupid_bucket.sql
--
-- Mickael, 2026-09-06: the April refunds belong in the same "not in Family"
-- bucket as the April charges. Otherwise the money coming back would land in
-- the household's income while the charge that produced it sat outside —
-- the refund would flatter the family numbers for a cost the family never
-- carried.
--
-- Two rows, both verified on the ledger before tagging:
--   2026-06-09  CREDITO APRIL             +R$14.877,03
--   2026-08-13  IOF de volta de April       +R$517,10
--
-- 0051 tagged only outgoing April charges (real_amount < 0). This adds the
-- incoming side. Note lib/pluggy/sync.ts applies tag rules regardless of
-- sign, so future April credits are already covered by the 'APRIL' rule —
-- this is the backfill for the two that already exist.
--
-- Also settled and needing no migration: pharmacies (Drogasil, Droga Raia,
-- Drogaria São Paulo, Drogacenter, Farmácia Indiana, the drugstore on Melo
-- Alves) stay in Family. That closes every open supplier question from the
-- 584-supplier review.

INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'stupid'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount > 0
  AND t.description_raw ILIKE '%APRIL%'
ON CONFLICT (transaction_id, tag_id) DO NOTHING;
