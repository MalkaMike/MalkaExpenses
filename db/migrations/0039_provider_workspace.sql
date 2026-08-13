-- ============================================================================
-- 0039_provider_workspace.sql
--
-- The unit of work moves from the invoice to the PROVIDER.
--
-- 33 medical invoices come from 12 providers. One phone call gets one report
-- covering all of that provider's visits — the request guidance was always
-- keyed by provider, but the steps and the documents were keyed by invoice. So
-- the same report had to be uploaded six times for D V Katz, and five of those
-- invoices would otherwise read "no documents" for ever.
--
-- `provider_key` is the invoice's CNPJ digits, or a slug of the provider name
-- when the invoice carries no CNPJ (lib/health/provider-group.ts).
--
-- claim_steps is DROPPED rather than migrated: it was created hours ago and
-- verified empty before this ran. Nothing is lost.
-- ============================================================================

DROP TABLE IF EXISTS claim_steps;

CREATE TABLE IF NOT EXISTS provider_steps (
  provider_key text NOT NULL,
  step_index int NOT NULL CHECK (step_index >= 0 AND step_index < 50),
  step_text text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by text NOT NULL,
  PRIMARY KEY (provider_key, step_index)
);

COMMENT ON TABLE provider_steps IS
  'Ticked-off request steps per provider. Absence of a row means not done.';
COMMENT ON COLUMN provider_steps.step_text IS
  'The wording at the time it was ticked, so an edited guidance list is detectable.';

ALTER TABLE provider_steps ENABLE ROW LEVEL SECURITY;

-- Documents now live at <provider_key>/<file> in the same bucket, so the count
-- view still groups on the first path segment — only the column's meaning
-- changed, and a column called nota_fiscal_id holding a provider key is how a
-- schema starts lying.
DROP VIEW IF EXISTS claim_attachment_counts;

CREATE OR REPLACE VIEW provider_attachment_counts AS
SELECT
  split_part(name, '/', 1) AS provider_key,
  count(*)::int            AS attachment_count
FROM storage.objects
WHERE bucket_id = 'claim-attachments'
  -- Only real files: an empty prefix leaves a placeholder row with no slash.
  AND position('/' IN name) > 0
GROUP BY 1;

COMMENT ON VIEW provider_attachment_counts IS
  'Documents collected per provider, read in one query. Consumed by /api/admin/health/queue.';

REVOKE ALL ON provider_attachment_counts FROM anon, authenticated;
