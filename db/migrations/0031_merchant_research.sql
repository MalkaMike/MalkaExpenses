-- ============================================================================
-- 0031_merchant_research.sql
--
-- "Deep research" feature: for a merchant the admin doesn't recognize, look up
-- CNPJ registry data (when a CNPJ can be found in the raw description) + run a
-- search-grounded Gemini call (web + ReclameAqui + official site), and store
-- one plain-language verdict instead of re-running the lookup every time.
--
-- Admin-only data (never shown to the household portal) — RLS enabled with no
-- policies, same deny-all-for-anon pattern as 0028.
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchant_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key text NOT NULL UNIQUE,
  verdict text NOT NULL CHECK (verdict IN ('legitimo', 'suspeito', 'desconhecido')),
  summary text NOT NULL,
  cnpj text,
  cnpj_data jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE merchant_research IS
  'Cached result of the deep-research lookup (CNPJ registry + search-grounded AI summary) per merchant cluster. Re-run only on explicit refresh.';
COMMENT ON COLUMN merchant_research.verdict IS
  'legitimo = looks like a real, identifiable business. suspeito = fraud/scam signals found. desconhecido = search turned up nothing conclusive.';
COMMENT ON COLUMN merchant_research.sources IS
  'Array of {title, url} the AI grounded its answer on, when Gemini returns grounding metadata.';

ALTER TABLE merchant_research ENABLE ROW LEVEL SECURITY;
