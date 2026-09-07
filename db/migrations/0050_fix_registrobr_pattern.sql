-- 0050_fix_registrobr_pattern.sql
--
-- 0049 used 'REGISTRO.BR' but the statement actually reads "RegistroBR"
-- (no dot), so the domain-registration charges never got tagged. Verified
-- against the ledger: the only two spellings are "RegistroBR" and
-- "RegistroBR 46080926". Small (R$192) but it would have kept missing
-- every future renewal too.

DELETE FROM merchant_rules WHERE pattern = 'REGISTRO.BR';

INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
VALUES ('REGISTROBR', 'contains', (SELECT id FROM reimbursement_tags WHERE slug = 'kenlo'), 0.95)
ON CONFLICT (pattern) DO UPDATE SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id;

INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'kenlo'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0 AND t.description_raw ILIKE '%REGISTROBR%'
ON CONFLICT (transaction_id, tag_id) DO NOTHING;
