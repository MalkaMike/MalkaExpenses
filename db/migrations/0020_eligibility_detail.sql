-- ============================================================================
-- 0020_eligibility_detail.sql
--
-- Audit-trail columns for the medical reimbursement eligibility engine.
-- The engine writes the final verdict + amount + applied rule into the existing
-- reimbursement_claims columns (eligibility, eligible_amount, applied_rule_id,
-- reasoning, confidence, determined_by, annual_used_before — all from 0018).
-- These new columns hold the FULL audit trail so every decision is verifiable:
--
--   eligibility_detail     — gate-by-gate breakdown + AI candidates + calc + source quotes
--   eligibility_determined_at — when the engine last ran
--   ai_model_used          — which model produced the verdict
--   deadline_date          — emission_date + 2y; indexed for "expiring claims" dashboards
--   manually_confirmed_at  — when set, the AI must NOT overwrite this row unless forced
--
-- Honesty principle: AI verdicts are unconfirmed by default. Only when a human
-- clicks Confirmar manualmente does manually_confirmed_at become non-null,
-- locking the row against engine re-runs.
-- ============================================================================

ALTER TABLE reimbursement_claims
  ADD COLUMN IF NOT EXISTS eligibility_detail        JSONB,
  ADD COLUMN IF NOT EXISTS eligibility_determined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model_used             TEXT,
  ADD COLUMN IF NOT EXISTS deadline_date             DATE,
  ADD COLUMN IF NOT EXISTS manually_confirmed_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rc_deadline_idx
  ON reimbursement_claims (deadline_date)
  WHERE eligibility IN ('eligible', 'partial', 'needs_prescription', 'needs_preauth');

COMMENT ON COLUMN reimbursement_claims.eligibility_detail IS
  'Full audit trail of the determination: AI category match (with candidates + confidence + reasoning),
   applied rule snapshot, gate-by-gate checklist with source_quotes, calculation breakdown.
   UI renders this verbatim so every claim has an auditable explanation.';

COMMENT ON COLUMN reimbursement_claims.deadline_date IS
  'Filing deadline = nota_fiscais.emission_date + 2 years (APRIL General Conditions).
   After this date the claim becomes out_of_filing_window regardless of other gates.';

COMMENT ON COLUMN reimbursement_claims.manually_confirmed_at IS
  'When set, the eligibility engine refuses to overwrite this row unless force=true is passed.
   Set by Confirmar manualmente in the UI.';

COMMENT ON COLUMN reimbursement_claims.ai_model_used IS
  'Model identifier used for the determination, e.g. gemini-2.5-pro. NULL for manual.';
