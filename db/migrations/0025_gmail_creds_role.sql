-- ============================================================================
-- 0025_gmail_creds_role.sql
--
-- Adds per-role Google OAuth credentials support.
-- Previously gmail_credentials stored a single connection (upserted by google_sub).
-- Now each role (admin, health) has its own row so each person's Sheets export
-- goes to their own Google Drive account.
--
-- Changes:
--   1. user_role TEXT NOT NULL DEFAULT 'admin' — which app role owns this credential
--   2. UNIQUE(user_role) — exactly one row per role; upsert on reconnect
--   3. Existing rows (if any) get user_role='admin' from the DEFAULT
-- ============================================================================

ALTER TABLE gmail_credentials
  ADD COLUMN IF NOT EXISTS user_role TEXT NOT NULL DEFAULT 'admin';

-- Deduplicate before adding the constraint: if multiple historical connect
-- sessions exist for the same role, keep only the row with the latest
-- connected_at (or highest id if connected_at is NULL).
DELETE FROM gmail_credentials
  WHERE id NOT IN (
    SELECT DISTINCT ON (user_role) id
    FROM gmail_credentials
    ORDER BY user_role, connected_at DESC NULLS LAST
  );

-- Drop if it already exists (idempotent re-run safety).
ALTER TABLE gmail_credentials
  DROP CONSTRAINT IF EXISTS gmail_creds_role_unique;

-- One credential row per role. On reconnect the row is updated in-place (upsert).
ALTER TABLE gmail_credentials
  ADD CONSTRAINT gmail_creds_role_unique UNIQUE (user_role);

COMMENT ON COLUMN gmail_credentials.user_role IS
  'App role that owns this OAuth connection (admin | health). One row per role.
   Re-connecting the same role overwrites the existing row.';
