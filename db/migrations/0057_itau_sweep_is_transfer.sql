-- 0057_itau_sweep_is_transfer.sql
--
-- Mickael, 2026-10-15: "fix the sweep first" (option A).
--
-- Itaú moves money automatically between the current account and its own
-- "Aplic Aut Mais" fund. That is the household's own money changing pocket,
-- not spending and not income. The 2025 rows (old wording "Apl/Res Aplic Aut
-- Mais") were already transfers. Since ~2026-09-22 Pluggy sends new wording
-- ("Saída APL APLIC AUT MAIS AP", "Resgate RES APLIC AUT MAIS", "Entrada RES
-- APLIC AUT MAIS AP") and the sync did not recognise it, so 7 rows counted:
--   out  R$ -57.104,35  as Family spending (category "Outros")
--   in   R$ +37.474,95  as income        (category "Receita")
-- (measured 2026-10-15 with the same regex as below, is_transfer = false only).
--
-- The sync now marks these as transfers (isInvestmentSweepDescription in
-- lib/reconciliation/cc-matcher.ts). This fixes the rows already in.
--
-- The interest line "REND PAGO APLIC AUT" is real income and is NOT touched:
-- the pattern needs "APL"/"RES" right before "APLIC AUT".
--
-- Scope is deliberately narrow: only rows still is_transfer = false. The 2025
-- rows are already excluded from totals and are left exactly as they are.
-- Possible duplicate pairs among these rows (same Pluggy row under two ids)
-- are handled separately, after Mickael reviews the duplicate list.

CREATE TABLE IF NOT EXISTS snapshot_0057_itau_sweep AS
SELECT id, category_id, is_transfer, shared_amount, confidence, ai_reasoning, status, now() AS taken_at
FROM transactions
WHERE description_raw ~* '\m(apl|res)\s+aplic\s+aut\M'
  AND is_transfer = false
  AND is_fake = false;

-- Snapshot sits in the public schema: lock it like every other table.
ALTER TABLE snapshot_0057_itau_sweep ENABLE ROW LEVEL SECURITY;

UPDATE transactions t
SET is_transfer   = true,
    shared_amount = 0,
    category_id   = (SELECT id FROM categories WHERE slug = 'transferencias'),
    confidence    = 0.99,
    ai_reasoning  = 'Aplicação/resgate automático — marcado como transferência (0057)'
FROM snapshot_0057_itau_sweep s
WHERE t.id = s.id;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run by hand if needed):
--
-- UPDATE transactions t
-- SET category_id = s.category_id, is_transfer = s.is_transfer,
--     shared_amount = s.shared_amount, confidence = s.confidence,
--     ai_reasoning = s.ai_reasoning, status = s.status
-- FROM snapshot_0057_itau_sweep s WHERE t.id = s.id;
-- DROP TABLE snapshot_0057_itau_sweep;
-- ---------------------------------------------------------------------------
