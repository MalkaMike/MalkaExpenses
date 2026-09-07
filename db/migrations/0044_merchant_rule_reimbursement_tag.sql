-- 0044_merchant_rule_reimbursement_tag.sql
--
-- merchant_rules already makes a category correction stick for every future
-- transaction from the same supplier (learned in app/api/transactions/[id],
-- applied in lib/pluggy/sync.ts categorizeFresh). Reimbursement tags
-- (Kenlo/Laik/Plano, from 0010) had no equivalent: tagging a supplier via
-- /api/admin/merchants/[key]/tag only bulk-applied to transactions that
-- already existed — a NEW charge from that same supplier synced in
-- untagged, every time. This lets a rule carry a tag the same way it
-- carries a category.
--
-- category_id becomes optional: a rule can now exist purely to carry a
-- reimbursement tag (no category correction attached), so it must no
-- longer be required — but a rule with neither field set does nothing,
-- so that combination is rejected outright.

ALTER TABLE merchant_rules ALTER COLUMN category_id DROP NOT NULL;

ALTER TABLE merchant_rules
  ADD COLUMN IF NOT EXISTS reimbursement_tag_id UUID REFERENCES reimbursement_tags(id) ON DELETE SET NULL;

ALTER TABLE merchant_rules
  ADD CONSTRAINT merchant_rules_has_effect
  CHECK (category_id IS NOT NULL OR reimbursement_tag_id IS NOT NULL);

-- Guards the check-then-insert/update in lib/merchants/merchant-rules.ts against
-- ever silently duplicating a pattern (3 rows exist today, all distinct).
ALTER TABLE merchant_rules ADD CONSTRAINT ux_merchant_rules_pattern UNIQUE (pattern);

CREATE INDEX IF NOT EXISTS ix_merchant_rules_reimb_tag
  ON merchant_rules(reimbursement_tag_id) WHERE reimbursement_tag_id IS NOT NULL;
