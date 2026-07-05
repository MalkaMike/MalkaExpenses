-- ============================================================================
-- 0033_family_providers.sql
--
-- Known family healthcare providers (doctors, dentists, therapists the family
-- actually uses). The merchant deep-research pipeline feeds this list to the
-- AI as context, so a PIX transfer to "Maria B" gets recognized as a payment
-- to the family's dermatologist instead of being flagged unknown/suspicious,
-- and gets the right category (saude) suggested.
--
-- Table schema only — the actual rows (names + phones = personal data) are
-- seeded directly into the DB, never committed to the repo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS family_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,   -- as saved in the family's phone contacts
  full_name text,               -- best professional identification found
  specialty text NOT NULL,      -- "dermatologista", "fonoaudióloga", ...
  clinic text,                  -- clinic/practice name when applicable
  phone text,
  confidence text NOT NULL DEFAULT 'unconfirmed'
    CHECK (confidence IN ('confirmed', 'probable', 'unconfirmed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE family_providers IS
  'Family healthcare providers, fed as context to merchant deep-research so payments to them are identified as legitimate health expenses. Admin-only.';

ALTER TABLE family_providers ENABLE ROW LEVEL SECURITY;
