-- ============================================================================
-- 0018_health_reimbursement.sql
--
-- Health section: insurance-policy knowledge base + automatic reimbursement
-- eligibility. Payment/submission to the insurer is OUT OF SCOPE (handled by a
-- separate app) — this subsystem only DETERMINES eligibility and limits.
--
-- Flow:
--   insurance_policies  ← the policy doc, parsed by AI into...
--   policy_coverage_rules  ← structured "data per data" rules (%, caps, limits)
--   policy_dependents   ← who is covered (maps to nota patient_name)
--   medical_documents   ← prescriptions / pedidos / laudos (scanned, paired w/ NF)
--   reimbursement_claims ← NF + prescription + policy → eligibility determination
-- ============================================================================

-- ── Policies ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_name          TEXT NOT NULL,           -- Bradesco Saúde, SulAmérica, Amil…
  plan_name             TEXT,                    -- "Top Nacional", "Prestige"…
  policy_number         TEXT,
  policy_type           TEXT NOT NULL DEFAULT 'saude',  -- saude | odonto | outro
  holder_name           TEXT,                    -- titular
  holder_cpf            TEXT,
  reimbursement_model   TEXT,                    -- free text: "múltiplo US/CH", "% do valor", "tabela própria"
  annual_ceiling        NUMERIC(14,2),           -- teto anual de reembolso (NULL = none/unknown)
  effective_from        DATE,
  effective_to          DATE,
  status                TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  source_file_path      TEXT,                    -- uploaded policy document
  raw_text              TEXT,                    -- full extracted policy text (audit/search)
  ai_extracted          BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_confidence TEXT,                    -- high | medium | low
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Who is covered (maps to nota_fiscais.patient_name) ──────────────────────────
CREATE TABLE IF NOT EXISTS policy_dependents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  cpf           TEXT,
  relationship  TEXT,                            -- titular | conjuge | filho | outro
  birth_date    DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pdep_policy_idx ON policy_dependents (policy_id);

-- ── Structured coverage rules — the "data per data" the AI extracts ─────────────
CREATE TABLE IF NOT EXISTS policy_coverage_rules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id            UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  category             TEXT NOT NULL,            -- consulta | exame | terapia | psicoterapia |
                                                 -- fisioterapia | exame_imagem | internacao |
                                                 -- odonto | vacina | medicamento | outro
  procedure_keywords   TEXT[],                   -- words/TUSS to map a NF service to this rule
  reimbursement_pct    NUMERIC(5,4),             -- e.g. 0.7000 = 70% (NULL if cap/multiple based)
  reimbursement_cap    NUMERIC(14,2),            -- max R$ reimbursed per event/session
  multiple_value       NUMERIC(14,2),            -- base value if model uses US/CH
  multiple_count       NUMERIC(8,2),             -- e.g. 2.00 (2x the base)
  annual_limit_amount  NUMERIC(14,2),            -- annual R$ cap for this category
  annual_limit_count   INT,                      -- e.g. 40 (sessions/year)
  limit_period         TEXT DEFAULT 'ano',       -- ano | mes
  waiting_period_days  INT,                      -- carência
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,  -- needs pedido médico
  requires_report      BOOLEAN NOT NULL DEFAULT FALSE,   -- needs relatório/laudo
  source_quote         TEXT,                     -- exact policy text this rule came from (verifiability)
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pcr_policy_idx ON policy_coverage_rules (policy_id);
CREATE INDEX IF NOT EXISTS pcr_category_idx ON policy_coverage_rules (category);

-- ── Medical documents: prescriptions / pedidos / laudos (paired with NFs) ───────
CREATE TABLE IF NOT EXISTS medical_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type      TEXT NOT NULL DEFAULT 'prescription',  -- prescription | pedido_exame | laudo | relatorio | guia
  patient_name  TEXT,
  doctor_name   TEXT,
  doctor_crm    TEXT,
  issue_date    DATE,
  description   TEXT,                            -- what was prescribed/requested
  file_path     TEXT,                            -- scanned image/pdf
  raw_text      TEXT,                            -- OCR text
  source        TEXT,                            -- mobile_scan | upload | gmail
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mdoc_patient_idx ON medical_documents (patient_name);
CREATE INDEX IF NOT EXISTS mdoc_type_idx ON medical_documents (doc_type);

-- ── Claims: NF + prescription + policy → eligibility determination ──────────────
CREATE TABLE IF NOT EXISTS reimbursement_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id      UUID REFERENCES nota_fiscais(id) ON DELETE CASCADE,
  policy_id           UUID REFERENCES insurance_policies(id) ON DELETE SET NULL,
  prescription_id     UUID REFERENCES medical_documents(id) ON DELETE SET NULL,
  patient_name        TEXT,

  -- AI determination
  eligibility         TEXT,         -- eligible | not_eligible | partial | over_limit |
                                    -- needs_review | needs_prescription
  eligible_amount     NUMERIC(14,2),-- computed reimbursable R$
  applied_rule_id     UUID REFERENCES policy_coverage_rules(id) ON DELETE SET NULL,
  reasoning           TEXT,         -- AI explanation: which rule, the math, why
  determined_by       TEXT,         -- ai | manual
  confidence          TEXT,         -- high | medium | low
  annual_used_before  NUMERIC(14,2),-- how much of the annual limit was used before this claim
  selected_manually   BOOLEAN NOT NULL DEFAULT FALSE,  -- user explicitly flagged for reimbursement

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nota_fiscal_id)
);
CREATE INDEX IF NOT EXISTS rc_nf_idx        ON reimbursement_claims (nota_fiscal_id);
CREATE INDEX IF NOT EXISTS rc_policy_idx    ON reimbursement_claims (policy_id);
CREATE INDEX IF NOT EXISTS rc_eligibility_idx ON reimbursement_claims (eligibility);

-- ── updated_at triggers ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_policy_updated_at ON insurance_policies;
CREATE TRIGGER trg_policy_updated_at BEFORE UPDATE ON insurance_policies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_claim_updated_at ON reimbursement_claims;
CREATE TRIGGER trg_claim_updated_at BEFORE UPDATE ON reimbursement_claims
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE insurance_policies IS 'Health/dental insurance policies; parsed by AI into policy_coverage_rules.';
COMMENT ON TABLE policy_coverage_rules IS 'Structured reimbursement rules extracted from a policy (%, caps, annual/session limits, carência, prescription requirement). source_quote keeps each rule verifiable against the policy text.';
COMMENT ON TABLE medical_documents IS 'Prescriptions / pedidos médicos / laudos, scanned (mobile) and paired with a nota fiscal for an insurance claim.';
COMMENT ON TABLE reimbursement_claims IS 'One per nota fiscal selected/found for reimbursement: pairs NF + prescription + policy and records the AI eligibility determination (reimbursable? within limit? how much?). Does NOT handle payment/submission.';
