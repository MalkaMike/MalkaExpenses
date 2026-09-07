-- 0048_fix_nu_pagamentos_and_manus_ai_tagging.sql
--
-- Two labelling mistakes found by inspection with Mickael on 2026-09-06:
--
-- 1) "NU PAGAMENTOS S/A" is Nubank's legal entity name, not a health
--    provider. 5 of these 8 checking->Nubank payments (paying the Nubank
--    card bill) were wrongly tagged 'insurance'. All 5 are already
--    is_transfer=true, so they never inflated the Health total — the tag
--    was just wrong on a row that isn't a real categorized expense at all.
--    Removed outright rather than moved to another tag.
--
-- 2) One more Nu Pagamentos row (2026-09-01, R$19.762,14) had NOT been
--    flagged as a transfer yet — identical wording/recipient to its 7
--    siblings (all already category 'cartao_pagamento'), just the most
--    recent and not yet caught by manual review. Brought in line with them:
--    is_transfer = true, category = cartao_pagamento. This removes
--    R$19.762,14 from September's "Family" spend — it's a card bill
--    payment, not new spend.
--
-- 3) "Manus AI" (an AI tool, 18 transactions) was tagged BOTH 'kenlo' AND
--    'insurance' — the same 17-of-18 charges double-counted in two buckets.
--    Confirmed by Mickael: Kenlo only. Insurance tag removed; a merchant
--    rule is added so future Manus AI charges auto-tag Kenlo (safe now —
--    checked against merchant_clusters, the pattern reaches only the
--    'manus_ai' supplier, no cross-contamination like 0047's ADOBE case).

-- 1) Remove the wrong Health tag from the 5 already-excluded Nu Pagamentos transfers.
DELETE FROM transaction_reimbursements
WHERE tag_id = (SELECT id FROM reimbursement_tags WHERE slug = 'insurance')
  AND transaction_id IN (
    '4c72fa3c-ff40-44d7-835c-7242f37c016c',
    '19fc96c5-e42e-4827-818a-75949368f5dc',
    '5facb34c-7d2f-4fad-80b9-39c7e92a5d8d',
    '8e1e51e6-1487-4ab4-9c90-559c877e7e5e',
    '78f87f6b-77db-426a-8dea-d2a8f3ba6a38'
  );

-- 2) Flag the Sept 1 payment as a transfer, matching its 7 identical siblings.
UPDATE transactions
SET is_transfer = true,
    category_id = (SELECT id FROM categories WHERE slug = 'cartao_pagamento')
WHERE id = 'f4e46ea2-531a-4260-a992-1ebe2e7132b8';

-- 3a) Remove the wrong Health tag from every Manus AI transaction.
DELETE FROM transaction_reimbursements
WHERE tag_id = (SELECT id FROM reimbursement_tags WHERE slug = 'insurance')
  AND transaction_id IN (SELECT id FROM transactions WHERE description_raw ILIKE '%MANUS AI%');

-- 3b) Learn the rule so future Manus AI charges auto-tag Kenlo (no category
--     attached — Manus AI's spend category is untouched by this fix).
INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT p, 'contains', (SELECT id FROM reimbursement_tags WHERE slug = 'kenlo'), 0.95
FROM (VALUES ('Google Manus AI'), ('MANUS AI'), ('MANUS AI SINGAPORE')) AS v(p)
ON CONFLICT (pattern) DO UPDATE
  SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id
  WHERE merchant_rules.reimbursement_tag_id IS NULL;
