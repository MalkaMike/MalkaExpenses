-- ============================================================================
-- 0011_gmail_integration.sql
--
-- Gmail OAuth integration — admin-only feature to look up nota fiscal /
-- invoice emails matching transaction date + merchant name.
--
-- Two tables:
--   gmail_credentials  — single row holding Mickael's OAuth refresh token.
--                        Refresh tokens are LONG-LIVED (don't expire) and
--                        used to mint short-lived access tokens on demand.
--   transaction_receipts — cached search results per transaction so we
--                          don't hit the Gmail API on every page render.
-- ============================================================================

-- ── Credentials ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gmail_credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity of the Google account that authorized us
  google_email        TEXT NOT NULL,
  google_sub          TEXT NOT NULL,                -- stable Google user id
  -- OAuth tokens — refresh_token never expires until user revokes; access_token
  -- has ~1h TTL and we mint a new one whenever we need to call the API.
  refresh_token       TEXT NOT NULL,
  access_token        TEXT,
  access_token_expiry TIMESTAMPTZ,
  scopes              TEXT NOT NULL,                -- granted OAuth scopes
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ,
  -- Soft-delete via revoked_at instead of DROP so audit log survives
  revoked_at          TIMESTAMPTZ,
  UNIQUE (google_sub)
);

CREATE INDEX IF NOT EXISTS gmail_credentials_active_idx
  ON gmail_credentials (connected_at DESC)
  WHERE revoked_at IS NULL;

-- ── Cached receipt lookups per transaction ──────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_receipts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  -- Gmail message ID (RFC 2822 thread/message identifier)
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id  TEXT NOT NULL,
  -- Snapshot for fast UI render without re-fetching the message
  subject          TEXT,
  from_email       TEXT,
  from_name        TEXT,
  sent_at          TIMESTAMPTZ,
  has_attachment   BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_count INT NOT NULL DEFAULT 0,
  -- Confidence score the matcher assigned (0..1)
  match_score      NUMERIC(3,2) NOT NULL DEFAULT 0,
  -- Free-form reason for the match (debug + UI tooltip)
  match_reason     TEXT,
  -- Was this match manually confirmed by Mickael? null = unconfirmed,
  -- true = confirmed, false = rejected.
  confirmed        BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS transaction_receipts_tx_idx
  ON transaction_receipts (transaction_id);
CREATE INDEX IF NOT EXISTS transaction_receipts_score_idx
  ON transaction_receipts (transaction_id, match_score DESC);

-- ── Audit hook ──────────────────────────────────────────────────────────────
COMMENT ON TABLE gmail_credentials IS
  'OAuth refresh tokens for Gmail nota fiscal lookup. Admin only — never returned to household.';
COMMENT ON TABLE transaction_receipts IS
  'Cached Gmail search results per transaction. Re-populated lazily via /api/admin/gmail/find-receipt.';
