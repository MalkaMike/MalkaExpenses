-- 0055_rename_bucket_and_close_rule_gaps.sql
--
-- PART 1 — rename the bucket. "Gastos Idiotas" fit a mobile game but not a
-- health-insurance premium; Mickael settled on "Not-in-Family", which names
-- the RULE (money that should not count in the family budget) rather than a
-- mood, so it still makes sense for whatever lands in it next.
--
-- PART 2 — close the recognition gaps. A coverage check asked the only
-- question that matters for "will this keep working": for every supplier
-- already labelled, does a rule exist that would catch its NEXT charge?
-- Seven did not:
--
--   insurance : "Pagamento de Pix QR Code CLINICA OFTALMOLO…"
--               "Pix enviado R 3 CLINICA MEDICA E PSIQUIATR…"
--   kenlo     : "ADOBE", "EBN         *ADOBE", "GITHUB  INC.",
--               "Pagamento de Pix QR Code LASTRO TECNOLOGIA",
--               "Pagamento de Pix QR Code ZOOP BRASIL"
--
-- Two of those are worth explaining:
--
--   ADOBE — 0047 deleted the 'ADOBE' rule because it also matched the
--   merchant "BancadoBento". That was not a clustering error: the letters
--   a-d-o-b-e literally occur inside "Banc-adoBe-nto". So Adobe gets two
--   narrow rules instead: '*ADOBE' (catches EBN*ADOBE, PPRO*ADOBE and the
--   spaced variant, none of which can occur inside a Portuguese word) and an
--   EXACT rule for the bare "ADOBE" description. BancadoBento matches
--   neither.
--
--   GITHUB — the existing rule was 'GITHUB INC.' with one space; the real
--   statement reads "GITHUB  INC." with two, so it never matched. Shortened
--   to 'GITHUB'.

-- ---------------------------------------------------------------------------
-- PART 1
-- ---------------------------------------------------------------------------
UPDATE reimbursement_tags
SET slug = 'not_family',
    name = 'Not-in-Family',
    description = 'Gastos que não entram no orçamento da família (jogo, prêmio de seguro saúde, etc.). Não é reembolso.'
WHERE slug = 'stupid';

-- ---------------------------------------------------------------------------
-- PART 2
-- ---------------------------------------------------------------------------
INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT v.p, v.ptype, (SELECT id FROM reimbursement_tags WHERE slug = v.s), 0.95
FROM (VALUES
  ('CLINICA OFTALMOLO',          'contains', 'insurance'),
  ('CLINICA MEDICA E PSIQUIATR', 'contains', 'insurance'),
  ('*ADOBE',                     'contains', 'kenlo'),
  ('ADOBE',                      'exact',    'kenlo'),
  ('GITHUB',                     'contains', 'kenlo'),
  ('LASTRO TECNOLOGIA',          'contains', 'kenlo'),
  ('ZOOP',                       'contains', 'kenlo')
) AS v(p, ptype, s)
ON CONFLICT (pattern) DO UPDATE
  SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id,
      pattern_type = EXCLUDED.pattern_type;
