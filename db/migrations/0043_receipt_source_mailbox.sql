-- ============================================================================
-- 0043_receipt_source_mailbox.sql
--
-- Records WHICH mailbox a receipt was found in.
--
-- Why: the nota fiscal search used to read exactly one Gmail account (the
-- `admin` credential), so "the mailbox" was implicit and every deep link was
-- built as .../mail/u/0/#inbox/<id> — the browser's FIRST signed-in account.
--
-- With a second `receipts` connection (personal mail, where shop receipts
-- actually land) that assumption breaks: a receipt found in the second mailbox
-- would open a link pointing at the first one, showing "message not found".
--
-- Storing the source address lets the link be built as
--   https://mail.google.com/mail/u/?authuser=<email>#inbox/<id>
-- which opens the correct mailbox regardless of sign-in order.
--
-- NULL means "found before this column existed" — those are all from the single
-- admin mailbox, and the link builder falls back to the old u/0 form for them.
-- ============================================================================

ALTER TABLE transaction_receipts
  ADD COLUMN IF NOT EXISTS source_email TEXT;

COMMENT ON COLUMN transaction_receipts.source_email IS
  'Google account the receipt was found in. NULL = pre-0043 rows (admin mailbox).';
