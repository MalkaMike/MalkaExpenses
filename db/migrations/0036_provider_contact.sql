-- ============================================================================
-- 0036_provider_contact.sql
--
-- Contact details for the providers on the reimbursement queue, so the "Ligar"
-- and WhatsApp buttons on a claim actually work.
--
-- Why a CNPJ column: the queue matched family_providers.full_name against the
-- invoice's provider_name, but an invoice carries the BILLING ENTITY's legal
-- name ("SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN"), never the
-- doctor's. That match therefore failed on nearly every row and the secretary
-- saw "sem telefone cadastrado" for the one task she has: phoning the clinic.
-- The CNPJ is on the invoice and is unambiguous, so it becomes the join key,
-- with the name match kept as the fallback for providers billed personally.
--
-- `source` records where a value came from. These were gathered by web search
-- and are NOT confirmed by a phone call — `confidence` stays 'probable' or
-- 'unconfirmed' until someone dials the number. A contact presented as fact
-- when nobody verified it sends a person on a wasted trip.
--
-- Schema only. Rows are personal data and are seeded straight into the DB,
-- never committed — same rule as 0033.
-- ============================================================================

ALTER TABLE family_providers ADD COLUMN IF NOT EXISTS cnpj text;
ALTER TABLE family_providers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE family_providers ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE family_providers ADD COLUMN IF NOT EXISTS source text;

-- Digits only, 14 chars, so the join never depends on punctuation. Formatting
-- for display is the UI's job.
ALTER TABLE family_providers DROP CONSTRAINT IF EXISTS family_providers_cnpj_digits;
ALTER TABLE family_providers ADD CONSTRAINT family_providers_cnpj_digits
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

-- One row per billing entity. Partial, because the doctors seeded in 0033 are
-- people with no CNPJ and several would collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS family_providers_cnpj_uniq
  ON family_providers (cnpj) WHERE cnpj IS NOT NULL;

COMMENT ON COLUMN family_providers.cnpj IS
  'Billing entity CNPJ, digits only. Join key from nota_fiscais.provider_cnpj — the invoice never carries the doctor name.';
COMMENT ON COLUMN family_providers.source IS
  'Where the contact came from. Web-search values are unverified until someone actually calls.';
