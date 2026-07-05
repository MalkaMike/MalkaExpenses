-- ============================================================================
-- 0032_merchant_research_ficha.sql
--
-- Upgrade merchant_research from a bare verdict+summary into a full "ficha"
-- (merchant dossier):
--   - New verdict 'pessoa_fisica' — the first bulk run force-fit personal PIX
--     transfers into legitimo/suspeito/desconhecido, contaminating the
--     "suspeito" bucket with ~dozens of personal names. People are not
--     businesses; they get their own verdict now.
--   - what_does  — one-line plain answer to "o que essa empresa faz?"
--   - website    — official site when found
--   - segment    — short industry label ("streaming de música", "farmácia")
--   - reclame_aqui — one-line reputation status from ReclameAqui search
--   - suggested_category_slug — AI's category suggestion from the app's own
--     taxonomy, so the admin can one-click fix a bad categorization.
--
-- what_does doubles as the schema-version marker: rows written before this
-- migration have it NULL, which the research routes treat as "old format,
-- re-research on next touch".
-- ============================================================================

ALTER TABLE merchant_research DROP CONSTRAINT IF EXISTS merchant_research_verdict_check;
ALTER TABLE merchant_research ADD CONSTRAINT merchant_research_verdict_check
  CHECK (verdict IN ('legitimo', 'suspeito', 'desconhecido', 'pessoa_fisica'));

ALTER TABLE merchant_research ADD COLUMN IF NOT EXISTS what_does text;
ALTER TABLE merchant_research ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE merchant_research ADD COLUMN IF NOT EXISTS segment text;
ALTER TABLE merchant_research ADD COLUMN IF NOT EXISTS reclame_aqui text;
ALTER TABLE merchant_research ADD COLUMN IF NOT EXISTS suggested_category_slug text;

COMMENT ON COLUMN merchant_research.what_does IS
  'One-line plain-language answer to "what does this merchant do?". NULL = row predates the ficha format and should be re-researched.';
COMMENT ON COLUMN merchant_research.suggested_category_slug IS
  'AI-suggested category slug from the app taxonomy (categories.slug), based on what the research found. NULL = no better suggestion than current.';
