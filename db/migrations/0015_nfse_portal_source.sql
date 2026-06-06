-- ============================================================================
-- 0015_nfse_portal_source.sql
--
-- Allows nota_fiscais rows imported from the SP NFS-e portal (source_type =
-- 'nfse_portal') to have no local file path (no PDF on disk).
-- Also widens source_type comment to reflect the three sources now in use.
-- ============================================================================

ALTER TABLE nota_fiscais
  ALTER COLUMN file_path DROP NOT NULL;

COMMENT ON COLUMN nota_fiscais.file_path IS
  'Filesystem path to the stored PDF. NULL for rows imported from the SP NFS-e
   portal (source_type = ''nfse_portal'') which have no local file.';

COMMENT ON COLUMN nota_fiscais.source_type IS
  'pdf_folder | gmail_email | nfse_portal';
