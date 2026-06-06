-- ============================================================================
-- 0017_nf_payment_plans.sql
--
-- Installment-aware payment intelligence for nota_fiscais.
--
-- A single nota fiscal is issued for the FULL service amount, but payment is
-- often split across many transactions (credit-card "10x", monthly boletos).
-- The old model (nota_fiscais.transaction_id = ONE tx) cannot express this.
--
-- nota_fiscal_payments is a 1-nota -> many-transactions join. Each row is one
-- charge that contributes to paying a nota. The matcher (scripts/match_payments.py)
-- populates it and rolls a payment_status up onto nota_fiscais.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nota_fiscal_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id    UUID NOT NULL REFERENCES nota_fiscais(id) ON DELETE CASCADE,
  transaction_id    UUID REFERENCES transactions(id) ON DELETE SET NULL,

  installment_k     INT,                       -- which installment (1..M); NULL if single/subset
  installment_m     INT NOT NULL DEFAULT 1,    -- plan size (1 = single payment)
  amount            NUMERIC(14,2),             -- this charge's amount (abs)
  charge_date       DATE,
  is_future         BOOLEAN NOT NULL DEFAULT FALSE,  -- charge_date > today (scheduled, not yet billed)

  match_method      TEXT,   -- installment_marker | single | subset_sum | recurring | manual
  match_confidence  TEXT,   -- high | medium | low

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (nota_fiscal_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS nfp_nf_idx  ON nota_fiscal_payments (nota_fiscal_id);
CREATE INDEX IF NOT EXISTS nfp_tx_idx  ON nota_fiscal_payments (transaction_id);

COMMENT ON TABLE nota_fiscal_payments IS
  'One row per bank charge that pays (part of) a nota fiscal. Supports installment
   plans (M charges), single payments, and unequal splits. Populated by the
   payment matcher; rolled up into nota_fiscais.payment_status.';

-- ── Rollup columns on nota_fiscais ────────────────────────────────────────────
ALTER TABLE nota_fiscais
  ADD COLUMN IF NOT EXISTS payment_status     TEXT,           -- paid_full | paying | scheduled | no_proof
  ADD COLUMN IF NOT EXISTS installments_total INT,            -- M (1 = single, NULL = unknown)
  ADD COLUMN IF NOT EXISTS installments_paid  INT,            -- charges dated <= today
  ADD COLUMN IF NOT EXISTS amount_paid        NUMERIC(14,2),  -- sum of charges <= today
  ADD COLUMN IF NOT EXISTS amount_pending     NUMERIC(14,2);  -- sum of future-dated charges

COMMENT ON COLUMN nota_fiscais.payment_status IS
  'paid_full = every installment charged; paying = some charged + future pending;
   scheduled = plan found but nothing charged yet; no_proof = no payment located.';
