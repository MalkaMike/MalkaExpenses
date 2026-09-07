-- 0053_health_insurance_reimbursement_label.sql
--
-- Mickael, 2026-09-06: when the health plan pays money BACK, it stays inside
-- the Family picture (it is household money) — but he wants those payments
-- grouped under their own label so they can be seen together instead of
-- disappearing into the noise of miscellaneous credits.
--
-- This is deliberately a LABEL, not a bucket: 'health_reimb' is absent from
-- the bucket CASE used for reporting, so a row carrying it still counts as
-- Family. That is the difference between this and 'stupid', which pulls a
-- row OUT of Family.
--
-- Not to be confused with 'insurance' (Plano), which marks an EXPENSE that
-- should be claimed back. This marks the money actually arriving.
--
-- The two payments found since Jan/2026 (R$4.478,79 total):
--   2026-01-27  REEMBOLSO SIN.SEG.SAUDE - DOCTO: 9343035   +R$574,31
--   2026-02-11  TED recebida BRADESCO SAUDE S A          +R$3.904,48
--
-- Pattern note: the rules below are deliberately narrow. A bare 'SAUDE'
-- would catch "CEDIPI -CT SAÚDE.SAO PAULO", which is a clinic CHARGE, and a
-- bare 'BRADESCO SAUDE' would catch a future premium PAYMENT — rules are
-- applied without regard to sign in lib/pluggy/sync.ts, so a premium would
-- be mislabelled as a refund. 'TED RECEBIDA BRADESCO SAUDE' and
-- 'REEMBOLSO SIN.SEG' only ever appear on money coming in.
-- (A reimbursement that arrives worded differently — a Pix instead of a TED —
-- will need one manual tag, which then sticks for that wording.)
--
-- The search that found these also matched "IOF de volta de Zara Mamila",
-- because "Zara M-amil-a" contains "amil". Excluded, obviously — recorded
-- here as a reminder of why these patterns stay narrow.

INSERT INTO reimbursement_tags (slug, name, color, icon, description, tracks_reimbursement)
VALUES ('health_reimb', 'Reembolso Plano de Saúde', 'info', 'banknote',
        'Dinheiro recebido de volta do plano de saúde. Continua contando na Família — é só um rótulo para ver todos juntos.',
        false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'health_reimb'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount > 0
  AND (t.description_raw ILIKE '%TED recebida BRADESCO SAUDE%'
       OR t.description_raw ILIKE '%REEMBOLSO SIN.SEG%')
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT v.p, 'contains', (SELECT id FROM reimbursement_tags WHERE slug = 'health_reimb'), 0.95
FROM (VALUES ('TED RECEBIDA BRADESCO SAUDE'), ('REEMBOLSO SIN.SEG')) AS v(p)
ON CONFLICT (pattern) DO UPDATE SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id;
