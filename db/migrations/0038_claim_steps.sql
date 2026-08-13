-- ============================================================================
-- 0038_claim_steps.sql
--
-- Which request steps are already done, per claim.
--
-- The Einstein claim asks for five separate things from three different places.
-- With no way to tick them off, one interrupted phone call means starting the
-- whole card again tomorrow — the secretary was keeping that state on paper,
-- which makes the paper the system of record and the app a viewer.
--
-- Keyed by step INDEX into the guidance list, not by its text: the wording is
-- edited in code and a text key would silently unmark finished work on every
-- copy edit. The trade-off is the opposite failure — reordering the steps in
-- code moves the ticks — so the guidance list is append-only in practice, and
-- `step_text` is stored alongside purely so a human can tell when that happened.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_steps (
  nota_fiscal_id uuid NOT NULL REFERENCES nota_fiscais(id) ON DELETE CASCADE,
  step_index int NOT NULL CHECK (step_index >= 0 AND step_index < 50),
  step_text text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by text NOT NULL,
  PRIMARY KEY (nota_fiscal_id, step_index)
);

COMMENT ON TABLE claim_steps IS
  'Ticked-off request steps per claim. Absence of a row means not done.';
COMMENT ON COLUMN claim_steps.step_text IS
  'The wording at the time it was ticked, so an edited guidance list is detectable.';

ALTER TABLE claim_steps ENABLE ROW LEVEL SECURITY;
