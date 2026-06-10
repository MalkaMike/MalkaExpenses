-- ============================================================================
-- 0028_rls_policies.sql — RLS defense-in-depth (audit C2)
--
-- Before this migration: the privacy wall was code-only. sharedClient() and
-- runtime guards prevented household code from reading real_amount or hidden
-- rows, but Postgres itself had no enforcement — a code bug or SQL injection
-- via service_role could bypass it.
--
-- After this migration: Postgres enforces the same constraints at the DB layer:
--   (a) anon role cannot read real_amount, notes_private, is_fake, or other
--       admin-only columns on transactions — column-level privilege revoked.
--   (b) anon sees only rows where shared_amount <> 0 — RLS policy.
--   (c) All 15 tables created in 0011–0021 (health, gmail, nota fiscal) now
--       have RLS enabled; no policies = deny-all for non-service-role.
--
-- sharedClient() was updated to use the anon key (lib/supabase/anon.ts) so
-- household-serving reads go through this enforcement path.
-- ============================================================================

-- ── 1. Enable RLS on tables that were created without it ────────────────────
--       No policies added = deny-all for anon/authenticated (admin-only tables)

ALTER TABLE gmail_credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_receipts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_fiscais            ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_fiscal_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_fiscal_flights     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_fiscal_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_dependents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_coverage_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_terms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_email_outbox     ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_feature_flags    ENABLE ROW LEVEL SECURITY;

-- ── 2. Column-level security on transactions ─────────────────────────────────
--
-- Supabase's default project setup grants `SELECT ON ALL TABLES IN SCHEMA
-- public TO anon`. Revoke the table-level grant, then re-grant only the
-- columns that shared_transactions_v needs. After this, a SELECT that
-- touches real_amount / notes_private / is_fake fails with a permission error
-- for the anon role, even if code somehow bypasses the runtime guards.
--
-- Columns kept (= shared_transactions_v column set):
--   id, account_id, date, description_clean, shared_amount, category_id,
--   status, is_transfer, source, created_at
--
-- Columns withheld from anon:
--   real_amount, notes_private, is_fake, description_raw, ai_reasoning,
--   confidence, reconciled_with_transaction_id, external_id, updated_at,
--   gmail_searched_at, gmail_match_count  (and any future admin-only columns)

REVOKE SELECT ON TABLE transactions FROM anon;

GRANT SELECT (
  id,
  account_id,
  date,
  description_clean,
  shared_amount,
  category_id,
  status,
  is_transfer,
  source,
  created_at
) ON TABLE transactions TO anon;

-- ── 3. RLS policy: household read access ────────────────────────────────────
--
-- Rows with shared_amount = 0 are "hidden" from the household view. This
-- enforces the same invariant as the WHERE clause in shared_transactions_v,
-- but at the Postgres row-security level.

DROP POLICY IF EXISTS anon_household_read ON transactions;
CREATE POLICY anon_household_read ON transactions
  FOR SELECT
  TO anon
  USING (shared_amount <> 0);

-- ── 4. Categories: anon read access ─────────────────────────────────────────
--
-- Categories are non-sensitive (names, icons, colors — no amounts). anon
-- needs SELECT to resolve the JOIN inside shared_transactions_v and for the
-- category picker in the household transaction view.
--
-- RLS is already enabled on categories (from 0001); a permissive USING (true)
-- policy is required since RLS with no policies defaults to deny-all.

GRANT SELECT ON TABLE categories TO anon;

DROP POLICY IF EXISTS anon_categories_read ON categories;
CREATE POLICY anon_categories_read ON categories
  FOR SELECT
  TO anon
  USING (true);
