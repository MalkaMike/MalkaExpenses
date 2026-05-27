-- 0002_view_category_slug.sql
-- Extend shared_transactions_v with category slug for faster client-side
-- icon/color rendering. Same security guarantees: still excludes real_amount,
-- is_fake, notes_private, and rows where shared_amount = 0.

CREATE OR REPLACE VIEW shared_transactions_v AS
SELECT
  t.id,
  t.account_id,
  t.date,
  t.description_clean AS description,
  t.shared_amount AS amount,
  t.category_id,
  c.slug AS category_slug,
  t.status,
  t.is_transfer,
  t.source,
  t.created_at
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.shared_amount <> 0;
