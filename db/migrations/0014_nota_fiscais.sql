-- ============================================================================
-- 0014_nota_fiscais.sql
--
-- Nota Fiscal (NFS-e) database — stores structured data extracted from the
-- 367+ PDF nota fiscais in Mickael's desktop folder.
--
-- Three tables:
--   nota_fiscais        — one row per NF (provider, amounts, dates, PDF path)
--   nota_fiscal_items   — line items within a NF (e.g. individual vaccines)
--   nota_fiscal_flights — airline/travel data for flight itineraries extracted
--                         from Gmail (GOL, LATAM, Azul, Booking, etc.)
-- ============================================================================

-- ── Main table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nota_fiscais (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Source file ─────────────────────────────────────────────────────────────
  file_name                   TEXT NOT NULL,          -- e.g. nota_10119183_447256.pdf
  file_path                   TEXT NOT NULL,          -- server-relative path to stored PDF
  source_type                 TEXT NOT NULL DEFAULT 'pdf_folder',  -- pdf_folder | gmail_email

  -- ── NF identifiers ──────────────────────────────────────────────────────────
  nf_number                   TEXT NOT NULL,          -- e.g. 00447256
  nf_serie                    TEXT,                   -- e.g. C0001
  rps_number                  TEXT,                   -- RPS number (pre-NF)
  rps_serie                   TEXT,
  national_id                 TEXT,                   -- Identificador Nacional (44 digits)
  verification_code           TEXT,                   -- Código de Verificação, e.g. KDJZ-QTXP
  municipal_registration      TEXT,                   -- Inscrição Municipal do prestador

  -- ── Provider (Prestador de Serviços) ────────────────────────────────────────
  provider_cnpj               TEXT,                   -- normalized: digits only
  provider_cnpj_formatted     TEXT,                   -- e.g. 43.312.511/0001-51
  provider_name               TEXT NOT NULL,
  provider_address            TEXT,
  provider_city               TEXT,
  provider_state              CHAR(2),

  -- ── Recipient (Tomador — always Mickael) ────────────────────────────────────
  recipient_cpf               TEXT,
  recipient_name              TEXT,

  -- ── Service ─────────────────────────────────────────────────────────────────
  service_code                TEXT,                   -- e.g. 04030
  service_description         TEXT,                   -- full Discriminação de Serviços
  patient_name                TEXT,                   -- extracted if mentioned in description
  intermediary_name           TEXT,                   -- Intermediário de Serviços, if any

  -- ── Financial ───────────────────────────────────────────────────────────────
  total_amount                NUMERIC(14,2) NOT NULL,
  deductions                  NUMERIC(14,2),
  base_calculation            NUMERIC(14,2),
  iss_rate                    NUMERIC(5,4),           -- e.g. 0.0200 = 2%
  iss_amount                  NUMERIC(14,2),
  ir_retained                 NUMERIC(14,2),
  cofins_retained             NUMERIC(14,2),
  pis_retained                NUMERIC(14,2),
  inss_retained               NUMERIC(14,2),

  -- ── Dates ───────────────────────────────────────────────────────────────────
  emission_date               TIMESTAMPTZ NOT NULL,   -- Data e Hora de Emissão
  rps_date                    DATE,                   -- date on the RPS
  payment_date                DATE,                   -- quitada em...

  -- ── Classification ──────────────────────────────────────────────────────────
  category_slug               TEXT,                   -- auto-mapped from service_code
  is_medical                  BOOLEAN NOT NULL DEFAULT FALSE,
  is_education                BOOLEAN NOT NULL DEFAULT FALSE,
  is_reimbursable             BOOLEAN NOT NULL DEFAULT FALSE, -- candidate for insurance reimbursement

  -- ── Transaction link ────────────────────────────────────────────────────────
  transaction_id              UUID REFERENCES transactions(id) ON DELETE SET NULL,
  match_confidence            TEXT,                   -- verified | high | medium | none
  match_source                TEXT,                   -- amount+date | gmail | manual

  -- ── Gmail dedup ─────────────────────────────────────────────────────────────
  gmail_message_id            TEXT,
  gmail_thread_id             TEXT,

  -- ── Reimbursement (populated in future session with insurance access) ────────
  reimbursement_status        TEXT DEFAULT 'not_submitted',
  -- not_submitted | submitted | approved | rejected | partial
  reimbursement_submitted_at  DATE,
  reimbursement_amount        NUMERIC(14,2),          -- actual amount reimbursed
  reimbursement_notes         TEXT,

  -- ── Raw ─────────────────────────────────────────────────────────────────────
  raw_text                    TEXT,                   -- full extracted text (search target)

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (file_name)
);

CREATE INDEX IF NOT EXISTS nf_emission_date_idx   ON nota_fiscais (emission_date DESC);
CREATE INDEX IF NOT EXISTS nf_provider_name_idx   ON nota_fiscais USING gin(to_tsvector('portuguese', coalesce(provider_name,'')));
CREATE INDEX IF NOT EXISTS nf_raw_text_idx        ON nota_fiscais USING gin(to_tsvector('portuguese', coalesce(raw_text,'')));
CREATE INDEX IF NOT EXISTS nf_transaction_idx     ON nota_fiscais (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS nf_patient_idx         ON nota_fiscais (patient_name) WHERE patient_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS nf_category_idx        ON nota_fiscais (category_slug);
CREATE INDEX IF NOT EXISTS nf_reimbursable_idx    ON nota_fiscais (is_reimbursable) WHERE is_reimbursable = TRUE;
CREATE INDEX IF NOT EXISTS nf_unlinked_idx        ON nota_fiscais (emission_date DESC) WHERE transaction_id IS NULL;

-- ── Line items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nota_fiscal_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id  UUID NOT NULL REFERENCES nota_fiscais(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(14,2),
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS nfi_nf_idx ON nota_fiscal_items (nota_fiscal_id);

-- ── Flight itineraries (from Gmail, linked as NF-type=viagem) ────────────────
CREATE TABLE IF NOT EXISTS nota_fiscal_flights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id  UUID NOT NULL REFERENCES nota_fiscais(id) ON DELETE CASCADE,
  leg_order       INT NOT NULL DEFAULT 0,   -- 0 = outbound, 1 = return, etc.
  direction       TEXT,                     -- outbound | return | oneway
  origin_city     TEXT,
  origin_airport  CHAR(3),                  -- IATA code if extractable
  dest_city       TEXT,
  dest_airport    CHAR(3),
  departure_date  DATE,
  departure_time  TEXT,                     -- HH:MM if available
  arrival_date    DATE,
  airline         TEXT,
  flight_number   TEXT,
  booking_ref     TEXT,
  passengers      TEXT[],                   -- array of passenger names
  fare_class      TEXT
);

CREATE INDEX IF NOT EXISTS nff_nf_idx      ON nota_fiscal_flights (nota_fiscal_id);
CREATE INDEX IF NOT EXISTS nff_depart_idx  ON nota_fiscal_flights (departure_date);

-- ── Updated-at trigger ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_nf_updated_at ON nota_fiscais;
CREATE TRIGGER trg_nf_updated_at
  BEFORE UPDATE ON nota_fiscais
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Comments ─────────────────────────────────────────────────────────────────
COMMENT ON TABLE nota_fiscais IS
  'Structured data extracted from NFS-e PDFs + Gmail flight itineraries. One row per document.';
COMMENT ON TABLE nota_fiscal_items IS
  'Individual line items within a nota fiscal (e.g. each vaccine in a medical NF).';
COMMENT ON TABLE nota_fiscal_flights IS
  'Flight legs parsed from airline confirmation emails linked to a nota_fiscal row.';
COMMENT ON COLUMN nota_fiscais.is_reimbursable IS
  'TRUE when this is a medical NF and a candidate for health insurance reimbursement. Populated by extraction pipeline.';
COMMENT ON COLUMN nota_fiscais.reimbursement_status IS
  'Lifecycle: not_submitted → submitted → approved/rejected/partial. Updated in future reimbursement session.';
