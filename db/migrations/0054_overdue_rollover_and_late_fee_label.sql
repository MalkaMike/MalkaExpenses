-- 0054_overdue_rollover_and_late_fee_label.sql
--
-- Two things, both agreed with Mickael on 2026-09-06.
--
-- PART 1 — the overdue-balance rollover is not spending.
-- On the Nubank card, three times, the same amount is debited and credited
-- on the SAME DAY in the SAME account:
--   19/06  Saldo em atraso −8.673,34   /  Crédito de atraso +8.673,34
--   19/07  Saldo em atraso −18.286,88  /  Crédito de atraso +18.286,88
--   19/08  Saldo em atraso −19.821,35  /  Crédito de atraso +19.821,35
-- That is the bank rolling an unpaid balance into the next statement, not
-- money leaving the household. The debit side was counting as R$46.781,57 of
-- Family spending. Marked as transfers (same treatment as the card bill
-- payment in 0048), which takes both sides out of the spend totals and out
-- of the shared ledger. Family for Jan–Sep drops to R$766.610,89.
--
-- PART 2 — what being late actually costs, made visible.
-- The interest and penalties were real money and were scattered inside
-- "Financeiro" where nothing showed them together. New LABEL 'late_fees'
-- (a label like 'health_reimb', NOT a bucket — the money stays in Family;
-- it is genuinely household spending, it just deserves to be seen).
--
-- Checked before writing the patterns: every "multa" in the ledger is a
-- late-payment penalty on a card — there are no traffic fines, which would
-- not belong here. A future traffic fine WOULD be caught by the 'MULTA'
-- rule and need untagging by hand; noted rather than pretended away.
--
-- Deliberately NOT included: "ANUIDADE DIFERENCIADA" (≈R$5.533 since Jan).
-- That is the card's annual fee — a cost of having the card, not a cost of
-- being late. It stays plain Family.

-- ---------------------------------------------------------------------------
-- PART 1
-- ---------------------------------------------------------------------------
UPDATE transactions
SET is_transfer = true,
    shared_amount = 0,
    category_id = (SELECT id FROM categories WHERE slug = 'transferencias')
WHERE is_fake = false
  AND (description_raw ILIKE '%Saldo em atraso%' OR description_raw ILIKE '%Crédito de atraso%');

-- ---------------------------------------------------------------------------
-- PART 2
-- ---------------------------------------------------------------------------
INSERT INTO reimbursement_tags (slug, name, color, icon, description, tracks_reimbursement)
VALUES ('late_fees', 'Juros e Multas', 'danger', 'alert-triangle',
        'Juros, multas e encargos por atraso ou uso de limite. Continua contando na Família — é um rótulo para enxergar quanto custa pagar tarde.',
        false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'late_fees'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0 AND t.is_transfer = false
  AND (
    t.description_raw ILIKE '%JUROS%'
    OR t.description_raw ILIKE '%MULTA%'
    OR t.description_raw ILIKE '%ENCARGO%'
    OR t.description_raw ILIKE '%IOF DE ATRASO%'
    OR t.description_raw ILIKE '%IOF DE FINANCIAMENTO%'
    OR t.description_raw ILIKE '%IOF S/ UTILIZACAO LIMITE%'
  )
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT v.p, 'contains', (SELECT id FROM reimbursement_tags WHERE slug = 'late_fees'), 0.95
FROM (VALUES ('JUROS'), ('MULTA'), ('ENCARGO'),
             ('IOF DE ATRASO'), ('IOF DE FINANCIAMENTO'), ('IOF S/ UTILIZACAO LIMITE')) AS v(p)
ON CONFLICT (pattern) DO UPDATE SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id;
