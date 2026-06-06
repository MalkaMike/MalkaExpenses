-- ============================================================================
-- 0019_policy_safe.sql
--
-- "The safe": store an international health policy (APRIL Ma Santé Internationale)
-- with its PRECISE rules, each carrying a verbatim source_quote and a
-- human_confirmed flag (AI extraction is unverified until a human eyeballs it).
--
-- Extends 0018 (insurance_policies / policy_coverage_rules / policy_dependents)
-- for international policies + adds policy_terms (exclusions / claim rules /
-- waiting periods / definitions) and policy_documents (the document vault registry).
-- ============================================================================

-- ── International policy fields ────────────────────────────────────────────────
ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS currency               TEXT,
  ADD COLUMN IF NOT EXISTS plan_tier              TEXT,         -- e.g. Premium
  ADD COLUMN IF NOT EXISTS cover_zone             TEXT,         -- e.g. "2"
  ADD COLUMN IF NOT EXISTS overall_annual_limit   TEXT,         -- free text (e.g. "unlimited", "€/$3,000,000")
  ADD COLUMN IF NOT EXISTS deductible_text        TEXT,         -- "sans franchise" / amount
  ADD COLUMN IF NOT EXISTS reimbursement_iban_last4 TEXT,       -- last 4 only (privacy)
  ADD COLUMN IF NOT EXISTS reimbursement_bank     TEXT,
  ADD COLUMN IF NOT EXISTS intermediary_name      TEXT,
  ADD COLUMN IF NOT EXISTS intermediary_email     TEXT,
  ADD COLUMN IF NOT EXISTS intermediary_phone     TEXT,
  ADD COLUMN IF NOT EXISTS claim_filing_limit     TEXT,         -- e.g. "2 years from the event"
  ADD COLUMN IF NOT EXISTS human_confirmed        BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Coverage-rule fields for benefit-table extraction ──────────────────────────
ALTER TABLE policy_coverage_rules
  ADD COLUMN IF NOT EXISTS section          TEXT,   -- Hospitalisation | Outpatient | Dental | Optical | Maternity | ...
  ADD COLUMN IF NOT EXISTS benefit_name     TEXT,   -- the specific benefit line
  ADD COLUMN IF NOT EXISTS coverage_basis   TEXT,   -- "100%", "up to €700/year", "not covered"
  ADD COLUMN IF NOT EXISTS plan_tier        TEXT,   -- Premium
  ADD COLUMN IF NOT EXISTS requires_preauth BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS human_confirmed  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Policy terms: exclusions, claim rules, waiting periods, definitions ─────────
CREATE TABLE IF NOT EXISTS policy_terms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  term_type       TEXT NOT NULL,   -- exclusion | claim_rule | waiting_period | required_document | definition | other
  title           TEXT,
  text            TEXT NOT NULL,
  source_quote    TEXT,
  source_document TEXT,            -- which PDF it came from
  human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pterm_policy_idx ON policy_terms (policy_id);
CREATE INDEX IF NOT EXISTS pterm_type_idx   ON policy_terms (term_type);

-- ── Document vault registry: the stored PDFs + their extractions ────────────────
CREATE TABLE IF NOT EXISTS policy_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id           UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  doc_type            TEXT,            -- table_of_benefits | general_conditions | certificate | member_guide | ipid | medical_certificate_form | privacy_notice | other
  file_name           TEXT NOT NULL,
  storage_path        TEXT,            -- vault path (local private/ now; Supabase Storage at deploy)
  sha256              TEXT,
  byte_size           BIGINT,
  extracted_json_path TEXT,            -- where the Gemini extraction JSON lives
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, file_name)
);
CREATE INDEX IF NOT EXISTS pdoc_policy_idx ON policy_documents (policy_id);

COMMENT ON TABLE policy_terms IS 'Exclusions / claim rules / waiting periods / required documents extracted from a policy, each with a verbatim source_quote; human_confirmed gates trust.';
COMMENT ON TABLE policy_documents IS 'The document vault: the original policy PDFs stored securely + a pointer to their Gemini extraction JSON.';
