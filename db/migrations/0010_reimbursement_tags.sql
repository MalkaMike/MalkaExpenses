-- 0010_reimbursement_tags.sql
--
-- Mickael needs to track expenses that he'll get reimbursed for:
--   - Kenlo (his employer/company that pays back work expenses)
--   - Laik (his media company — work-related expenses)
--   - Insurance (medical expenses from Saúde category to be claimed)
--
-- Each tagged transaction has an independent reimbursement workflow:
--   pending → submitted → reimbursed | declined
-- with optional partial reimbursement_amount and notes (claim id, etc).
--
-- Orthogonal to category_id — a "Saúde" tx can have "insurance" tag, a
-- "Restaurantes" tx can have "kenlo" tag. A single tx can have multiple
-- tags (rare but allowed: e.g. business meal partially expensed to both
-- Kenlo and Laik).
--
-- Affects the household ledger: a fully-reimbursed expense is NET ZERO
-- for the household budget. Mickael can use the existing "Ajustar"
-- button on the merchant page to set shared_amount = real_amount -
-- expected_reimbursement. We DO NOT auto-mutate shared_amount here.

CREATE TABLE IF NOT EXISTS reimbursement_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,                   -- 'kenlo' | 'laik' | 'insurance' | future
  name        TEXT NOT NULL,                          -- display name
  color       TEXT NOT NULL DEFAULT 'fg',             -- semantic color token: fg|accent|warning|danger|info|purple
  icon        TEXT NOT NULL DEFAULT 'tag',            -- lucide icon name
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_reimbursements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id                UUID NOT NULL REFERENCES reimbursement_tags(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','submitted','reimbursed','declined')),
  -- If NULL, the full real_amount is the reimbursement claim. Override when
  -- only a portion is reimbursable (e.g. R$200 expense, R$150 reimbursable).
  reimbursement_amount  NUMERIC(14, 2),
  submitted_at          TIMESTAMPTZ,
  reimbursed_at         TIMESTAMPTZ,
  notes                 TEXT,                          -- claim number, comments
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, tag_id)
);

CREATE INDEX IF NOT EXISTS ix_tx_reimb_tag_status
  ON transaction_reimbursements(tag_id, status);

CREATE INDEX IF NOT EXISTS ix_tx_reimb_tx
  ON transaction_reimbursements(transaction_id);

CREATE INDEX IF NOT EXISTS ix_tx_reimb_pending
  ON transaction_reimbursements(tag_id, created_at DESC)
  WHERE status IN ('pending','submitted');

-- updated_at trigger reusing the helper from migration 0007
DROP TRIGGER IF EXISTS trg_tx_reimb_updated_at ON transaction_reimbursements;
CREATE TRIGGER trg_tx_reimb_updated_at
BEFORE UPDATE ON transaction_reimbursements
FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE reimbursement_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_reimbursements ENABLE ROW LEVEL SECURITY;

-- Seed the three tags Mickael named
INSERT INTO reimbursement_tags(slug, name, color, icon, description) VALUES
  ('kenlo',     'Kenlo',     'accent',  'briefcase', 'Despesas de trabalho a serem reembolsadas pela Kenlo'),
  ('laik',      'Laik',      'purple',  'briefcase', 'Despesas a serem reembolsadas pela Laik'),
  ('insurance', 'Plano',     'info',    'shield',    'Despesas médicas a serem reembolsadas pelo plano de saúde')
ON CONFLICT (slug) DO NOTHING;
