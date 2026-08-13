-- ============================================================================
-- 0037_claim_attachment_counts.sql
--
-- How many documents are stored against each claim, in ONE query.
--
-- The queue was asking object storage once per claim — 23 parallel list() calls
-- from a serverless function. It worked on a warm dev server and returned
-- nothing at all in production, so every row rendered "?" and the "Falta
-- documento" / "Já tem documento" filters both counted zero. Fanning out one
-- network call per row was the wrong shape regardless of why it failed.
--
-- Storage metadata is an ordinary table, so a grouped view answers it once.
-- Files live at <notaFiscalId>/<name>, hence split_part on the prefix.
-- ============================================================================

CREATE OR REPLACE VIEW claim_attachment_counts AS
SELECT
  split_part(name, '/', 1) AS nota_fiscal_id,
  count(*)::int            AS attachment_count
FROM storage.objects
WHERE bucket_id = 'claim-attachments'
  -- Only real files: an empty prefix leaves a placeholder row with no slash.
  AND position('/' IN name) > 0
GROUP BY 1;

COMMENT ON VIEW claim_attachment_counts IS
  'Documents collected per claim, read in one query instead of one storage list() per row. Consumed by /api/admin/health/queue.';

-- The API reads with the service_role key, which bypasses RLS; no grant to
-- anon/authenticated, so the view is not reachable from a browser.
REVOKE ALL ON claim_attachment_counts FROM anon, authenticated;
