-- ============================================================================
-- 0023_storage_paths.sql
--
-- Adds Supabase Storage pointers (storage_bucket + storage_path) to tables
-- that currently store files on local disk. After running migrate_files_to_supabase.mjs,
-- production reads from storage_bucket/storage_path; file_path kept for dev fallback.
--
-- Buckets (create in Supabase dashboard as PRIVATE, no public access):
--   nota-fiscais         — NFS-e PDFs
--   medical-documents    — prescriptions / pedidos / laudos
--   insurance-vault      — policy PDFs (APRIL and future)
--   claim-attachments    — generated claim summaries (future)
-- ============================================================================

ALTER TABLE nota_fiscais
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_path   TEXT;

ALTER TABLE medical_documents
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_path   TEXT;

-- insurance_policies.source_file_path is kept; add storage pointer alongside
ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_path   TEXT;

-- policy_documents already has storage_path (from 0019); add bucket only
ALTER TABLE policy_documents
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT;

-- Indexes — only for rows that have been migrated to storage
CREATE INDEX IF NOT EXISTS nf_storage_path_idx   ON nota_fiscais      (storage_path) WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS mdoc_storage_path_idx  ON medical_documents (storage_path) WHERE storage_path IS NOT NULL;

COMMENT ON COLUMN nota_fiscais.storage_bucket      IS 'Supabase Storage bucket name; NULL until migrate_files_to_supabase.mjs has run.';
COMMENT ON COLUMN nota_fiscais.storage_path        IS 'Object path within the bucket (file name only, no bucket prefix).';
COMMENT ON COLUMN medical_documents.storage_bucket IS 'Supabase Storage bucket name; NULL until migrated.';
COMMENT ON COLUMN medical_documents.storage_path   IS 'Object path within the bucket.';
