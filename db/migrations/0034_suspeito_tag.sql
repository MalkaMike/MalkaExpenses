-- ============================================================================
-- 0034_suspeito_tag.sql
--
-- New reimbursement_tags row: "Suspeito" — flags an expense Mickael couldn't
-- identify during review. Unlike Kenlo/Laik/Plano, it's not a reimbursement
-- claim (nobody owes money for it), it's a shared "we don't know what this
-- is" marker that BOTH Mickael and Ayelet can add or remove:
--   - Admin side: applying it marks the merchant reviewed (leaves "Para
--     revisar") and forces the transaction visible to Ayelet, same
--     mechanism as the existing tags (see app/api/admin/merchants/[key]/tag).
--   - Household side (new): Ayelet gets her own toggle on the transaction
--     list she already uses, via a new admin/health/household-scoped
--     endpoint — she had NO tag-mutation capability before this.
--
-- tracks_reimbursement distinguishes "real reimbursement claim" tags
-- (Kenlo/Laik/Plano — tracked on /admin/reembolsos with a claim-status
-- workflow) from "suspeito" (informational flag, no claim, no status to
-- track) so it doesn't pollute the reimbursement claims page.
-- ============================================================================

ALTER TABLE reimbursement_tags
  ADD COLUMN IF NOT EXISTS tracks_reimbursement boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN reimbursement_tags.tracks_reimbursement IS
  'true = real reimbursement claim tracked on /admin/reembolsos (Kenlo/Laik/Plano). false = informational flag only (e.g. Suspeito) — excluded from the claims page.';

INSERT INTO reimbursement_tags (slug, name, color, icon, description, tracks_reimbursement) VALUES
  ('suspeito', 'Suspeito', 'danger', 'alert', 'Despesa que Mickael não conseguiu identificar — visível para Ayelet, qualquer um dos dois pode marcar ou desmarcar', false)
ON CONFLICT (slug) DO NOTHING;
