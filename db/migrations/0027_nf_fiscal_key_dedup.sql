-- ============================================================================
-- 0027_nf_fiscal_key_dedup.sql
--
-- Stronger duplicate guards on nota_fiscais, surfaced by the NF-pipeline audit.
-- 0026 added gmail_message_id + (nf_number, provider_cnpj). These two add the
-- canonical Brazilian fiscal identifiers, which are the strongest "same NF"
-- keys available:
--   • national_id        — the NFS-e national access key (chave de acesso)
--   • verification_code  — the município verification code (código de verificação)
--
-- A filename rename or a portal re-download with a different name pattern can
-- slip past the existing UNIQUE(file_name) backstop; these fiscal keys can't be
-- forged by a rename. Verified live before adding: 0 duplicates on either.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS nf_national_id_unique
  ON nota_fiscais (national_id)
  WHERE national_id IS NOT NULL AND national_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS nf_verification_code_unique
  ON nota_fiscais (verification_code)
  WHERE verification_code IS NOT NULL AND verification_code <> '';
