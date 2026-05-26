-- ============================================================================
-- 0001_init.sql  —  Personal Finance dual-ledger schema
-- ============================================================================
-- Critical invariant: the shared_transactions_v VIEW is the security wall
-- between the shared (wife-visible) code path and the private code path.
-- Any code reading transactions for the shared view MUST query the view,
-- not the table.
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('checking', 'savings', 'credit_card');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_source AS ENUM ('ofx', 'csv', 'pdf', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_status AS ENUM ('auto_accepted', 'pending_review', 'user_confirmed', 'user_edited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_creator AS ENUM ('user', 'ai', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- ACCOUNTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bank TEXT NOT NULL,
  type account_type NOT NULL,
  real_starting_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  shared_starting_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  cc_issuer TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- CATEGORIES (hierarchical)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

-- BR taxonomy seed
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Moradia', 'moradia', 'home', 10),
  ('Mercado', 'mercado', 'shopping-cart', 20),
  ('Restaurantes', 'restaurantes', 'utensils', 30),
  ('Transporte', 'transporte', 'car', 40),
  ('Lazer', 'lazer', 'music', 50),
  ('Saúde', 'saude', 'heart-pulse', 60),
  ('Educação', 'educacao', 'graduation-cap', 70),
  ('Assinaturas', 'assinaturas', 'repeat', 80),
  ('Vestuário', 'vestuario', 'shirt', 90),
  ('Viagens', 'viagens', 'plane', 100),
  ('Presentes', 'presentes', 'gift', 110),
  ('Impostos', 'impostos', 'landmark', 120),
  ('Transferências', 'transferencias', 'arrow-left-right', 130),
  ('Cartão (pagamento)', 'cartao_pagamento', 'credit-card', 140),
  ('Receita', 'receita', 'trending-up', 150),
  ('Outros', 'outros', 'circle', 999)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- STATEMENT IMPORTS (declared before transactions for FK)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  file_name TEXT,
  file_type TEXT NOT NULL,
  storage_path TEXT,
  parsed_at TIMESTAMPTZ,
  transaction_count INT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  -- For CC statements: closing balance + due date, used by reconciliation
  closing_balance NUMERIC(14, 2),
  due_date DATE,
  parse_errors JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TRANSACTIONS — the heart
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description_raw TEXT NOT NULL,
  description_clean TEXT,
  -- DUAL LEDGER: real_amount = truth; shared_amount = what wife sees
  real_amount NUMERIC(14, 2) NOT NULL,
  shared_amount NUMERIC(14, 2) NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  confidence NUMERIC(3, 2),
  ai_reasoning TEXT,
  source tx_source NOT NULL,
  source_file_id UUID REFERENCES statement_imports(id) ON DELETE SET NULL,
  reconciled_with_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  status tx_status NOT NULL DEFAULT 'pending_review',
  is_fake BOOLEAN NOT NULL DEFAULT FALSE,
  is_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  created_by tx_creator NOT NULL DEFAULT 'import',
  notes_private TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tx_account_date ON transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_tx_status_pending ON transactions(status) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS ix_tx_external ON transactions(account_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_dedup
  ON transactions(account_id, date, real_amount, description_raw)
  WHERE source IN ('ofx', 'csv', 'pdf');

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tx_updated_at ON transactions;
CREATE TRIGGER trg_tx_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- THE SECURITY WALL: shared_transactions_v
-- ----------------------------------------------------------------------------
-- Shared code paths query this view, NOT the table. It excludes:
--   - real_amount       (truth)
--   - is_fake           (signal that an entry isn't real)
--   - notes_private     (Mickael-only memo)
--   - rows where shared_amount = 0 (hidden entries vanish entirely)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW shared_transactions_v AS
SELECT
  id,
  account_id,
  date,
  description_clean AS description,
  shared_amount AS amount,
  category_id,
  status,
  is_transfer,
  source,
  created_at
FROM transactions
WHERE shared_amount <> 0;

-- ----------------------------------------------------------------------------
-- MERCHANT RULES (learned auto-categorization)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'contains',
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence_default NUMERIC(3, 2) NOT NULL DEFAULT 0.95,
  created_from_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_merchant_pattern ON merchant_rules(pattern);

-- ----------------------------------------------------------------------------
-- CC RECONCILIATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cc_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cc_statement_import_id UUID NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
  match_confidence NUMERIC(3, 2),
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- AUDIT LOG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  mode TEXT,
  action TEXT NOT NULL,
  transaction_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at DESC);

-- ----------------------------------------------------------------------------
-- APP SETTINGS (single row)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1,
  private_pin_hash TEXT,
  private_mode_timeout_minutes INT NOT NULL DEFAULT 15,
  decoy_label TEXT NOT NULL DEFAULT 'Sync',
  CHECK (id = 1)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY — all access goes through service_role from API layer
-- ----------------------------------------------------------------------------
ALTER TABLE accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_imports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_reconciliations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;
-- No policies = anon/authenticated roles cannot read or write.
-- Only service_role (server-only key) bypasses RLS.
