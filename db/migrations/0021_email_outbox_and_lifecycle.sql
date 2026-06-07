-- ============================================================================
-- 0021_email_outbox_and_lifecycle.sql
--
-- Auto-email to Celina (secretária @ Laik) when a reimbursement claim has all
-- 3 parts (payment + NF + prescription). The outbox enforces idempotency via a
-- UNIQUE key — the same claim+state can never produce a second email.
--
-- Lifecycle on reimbursement_claims tracks: claim assembled -> emailed -> Celina
-- confirms received -> Celina confirms sent to insurer -> money received.
-- The user chose immediate full-auto send; a kill-switch in app_settings can
-- pause without redeploy.
-- ============================================================================

-- ── Outbox ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_email_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id            UUID NOT NULL REFERENCES reimbursement_claims(id) ON DELETE CASCADE,
  idempotency_key     TEXT NOT NULL UNIQUE,    -- e.g. "claim:<id>:send-to-secretary"
  to_email            TEXT NOT NULL,
  subject             TEXT NOT NULL,
  body_html           TEXT NOT NULL,
  attachments_meta    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{bucket?, path, filename, mime_type, kind}]
  status              TEXT NOT NULL DEFAULT 'pending',     -- pending | sent | failed | paused
  attempts            INT NOT NULL DEFAULT 0,
  last_error          TEXT,
  scheduled_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  gmail_message_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS heo_status_idx ON health_email_outbox (status, scheduled_at);
CREATE INDEX IF NOT EXISTS heo_claim_idx  ON health_email_outbox (claim_id);

COMMENT ON COLUMN health_email_outbox.idempotency_key IS
  'Deterministic key like "claim:<id>:send-to-secretary". Unique constraint prevents
   double-sends — re-triggering the same claim is a no-op.';

-- ── Lifecycle columns on reimbursement_claims ────────────────────────────────
ALTER TABLE reimbursement_claims
  ADD COLUMN IF NOT EXISTS lifecycle_state         TEXT NOT NULL DEFAULT 'draft',
                              -- draft | ready_to_send | queued_email | sent_to_secretary
                              -- | received_by_secretary | sent_by_secretary
                              -- | reimbursed | rejected
  ADD COLUMN IF NOT EXISTS queued_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_secretary_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by_secretary_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by_secretary_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursed_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rc_lifecycle_idx ON reimbursement_claims (lifecycle_state);

COMMENT ON COLUMN reimbursement_claims.lifecycle_state IS
  'Reimbursement workflow state. Independent from eligibility — a claim can be
   eligible (engine verdict) AND not yet sent (lifecycle).';

-- ── Feature flags (for the kill-switch toggle on /admin/health) ─────────────
-- app_settings is a singleton config row (private_pin_hash etc.), not k/v —
-- use a dedicated flags table instead.
CREATE TABLE IF NOT EXISTS health_feature_flags (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO health_feature_flags (key, value)
VALUES ('auto_send_secretary', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE health_feature_flags IS
  'Small k/v feature flags for the Health subsystem. The kill-switch
   auto_send_secretary toggles the email outbox without redeploy.';
