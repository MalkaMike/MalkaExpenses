-- ============================================================================
-- 0013_receipts_value_match.sql
--
-- Add confidence + match-source columns to transaction_receipts so the v2
-- value-verified search can record HOW it matched (subject vs PDF vs OCR).
-- ============================================================================

ALTER TABLE transaction_receipts
  ADD COLUMN IF NOT EXISTS confidence    TEXT,
  ADD COLUMN IF NOT EXISTS match_source  TEXT,
  ADD COLUMN IF NOT EXISTS match_snippet TEXT,
  ADD COLUMN IF NOT EXISTS amount_brl    NUMERIC(14,2);

COMMENT ON COLUMN transaction_receipts.confidence IS
  'verified = value found in attached PDF/OCR; high = found in email subject/snippet';
COMMENT ON COLUMN transaction_receipts.match_source IS
  'where the value was located: subject | snippet | pdf-text | vision-ocr | raw-text';
COMMENT ON COLUMN transaction_receipts.match_snippet IS
  'context excerpt around the matched value for UI display';
COMMENT ON COLUMN transaction_receipts.amount_brl IS
  'the transaction amount that was matched against (snapshot for audit)';
