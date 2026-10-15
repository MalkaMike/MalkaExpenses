-- 0060_property_tax_and_ubersuggest_categories.sql
--
-- Mickael, 2026-10-15: "fix the property tax (PMSP) category to Impostos and
-- Ubersuggest to Produtividade & SaaS, with narrow rules and a migration."
--
-- Pluggy files both wrongly (measured 2026-10-15 on its own category field):
--   "IMPOSTO MUNICIPAL - PMSP-…"  → "Gas stations"           → Combustível
--   "Ubersuggest" (Neil Patel SEO) → "Taxi and ride-hailing"  → Transporte
-- and the sync let Pluggy's category beat merchant rules. The sync now applies
-- merchant rules first (lib/pluggy/sync.ts, step 0.2), so these two rules keep
-- new rows right; this migration fixes the rows already in.
--
-- Reach checked before writing (2026-10-15):
--   'IMPOSTO MUNICIPAL - PMSP' (starts_with) → 9 rows, 1 supplier, Bradesco only,
--     R$ -7.914,83. No other "PMSP"/"IMPOSTO MUNICIPAL" text in the ledger.
--   'UBERSUGGEST' (contains, existing Laik tag rule) → 14 rows, Ubersuggest only,
--     R$ -409,56. The Laik bucket tag is unchanged; only the category is added.
-- Only category_id changes. Buckets, shared amounts and transfers are untouched.

CREATE TABLE IF NOT EXISTS snapshot_0060_categories AS
SELECT id, category_id, now() AS taken_at
FROM transactions
WHERE description_raw ILIKE 'IMPOSTO MUNICIPAL - PMSP%'
   OR description_raw ILIKE '%UBERSUGGEST%';

CREATE TABLE IF NOT EXISTS snapshot_0060_rules AS
SELECT * FROM merchant_rules WHERE pattern IN ('IMPOSTO MUNICIPAL - PMSP', 'UBERSUGGEST');

ALTER TABLE snapshot_0060_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_0060_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT count(*) FROM snapshot_0060_categories) <> 23 THEN
    RAISE EXCEPTION '0060: expected 23 rows (9 property tax + 14 Ubersuggest)';
  END IF;
  IF (SELECT count(*) FROM categories WHERE slug IN ('impostos', 'produtividade_saas')) <> 2 THEN
    RAISE EXCEPTION '0060: category slug missing';
  END IF;
END $$;

INSERT INTO merchant_rules (pattern, pattern_type, category_id, confidence_default)
VALUES ('IMPOSTO MUNICIPAL - PMSP', 'starts_with', (SELECT id FROM categories WHERE slug = 'impostos'), 0.99)
ON CONFLICT (pattern) DO UPDATE
  SET category_id = EXCLUDED.category_id, pattern_type = EXCLUDED.pattern_type;

UPDATE merchant_rules
SET category_id = (SELECT id FROM categories WHERE slug = 'produtividade_saas')
WHERE pattern = 'UBERSUGGEST';

UPDATE transactions
SET category_id = (SELECT id FROM categories WHERE slug = 'impostos')
WHERE id IN (SELECT id FROM snapshot_0060_categories)
  AND description_raw ILIKE 'IMPOSTO MUNICIPAL - PMSP%';

UPDATE transactions
SET category_id = (SELECT id FROM categories WHERE slug = 'produtividade_saas')
WHERE id IN (SELECT id FROM snapshot_0060_categories)
  AND description_raw ILIKE '%UBERSUGGEST%';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run by hand if needed):
--
-- UPDATE transactions t SET category_id = s.category_id
-- FROM snapshot_0060_categories s WHERE t.id = s.id;
-- DELETE FROM merchant_rules WHERE pattern = 'IMPOSTO MUNICIPAL - PMSP'
--   AND NOT EXISTS (SELECT 1 FROM snapshot_0060_rules WHERE pattern = 'IMPOSTO MUNICIPAL - PMSP');
-- UPDATE merchant_rules m SET category_id = s.category_id, pattern_type = s.pattern_type
-- FROM snapshot_0060_rules s WHERE m.pattern = s.pattern;
-- DROP TABLE snapshot_0060_categories; DROP TABLE snapshot_0060_rules;
-- ---------------------------------------------------------------------------
