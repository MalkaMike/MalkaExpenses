-- ============================================================================
-- 0016_no_match_reason.sql
--
-- Adds no_match_reason to nota_fiscais so users can classify WHY an NF has
-- no linked transaction (plano_direto | dinheiro | miles | pendente).
-- ============================================================================

ALTER TABLE nota_fiscais
  ADD COLUMN IF NOT EXISTS no_match_reason TEXT;

COMMENT ON COLUMN nota_fiscais.no_match_reason IS
  'Why this NF has no linked transaction:
   plano_direto  — paid via health/dental plan (no out-of-pocket card charge)
   dinheiro      — paid in cash
   miles         — paid with airline miles or reward points
   pendente      — needs investigation
   NULL          — not yet classified (default)';
