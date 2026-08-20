-- 0039 — Re-point the Nubank accounts at their MeuPluggy connection.
--
-- Same treatment as 0036 did for Itaú, and for the same reason: the app's Pluggy
-- key sits in an expired trial workspace and cannot refresh real bank items, so
-- the old Nubank item has been frozen at 2026-06-03. The live data lives in
-- Meu Pluggy, shared with the app as item f5acd603-8dea-4a67-82c8-64175870e37b
-- (created 2026-08-20, lastUpdatedAt 11:29).
--
-- Mapping verified by (date, amount) overlap against the existing ledger:
--   Nu Pagamentos 09286753-3 -> "Nu Pagamentos S.A. …"  9/9 sampled rows matched
--   ultraviolet-black 0025   -> "ultraviolet-black"     7/14 (next best: 1/14)
--
-- The card's 7/14 is expected, not a warning sign: Meu Pluggy holds 395
-- transactions for that card where the app only ever received 154, so half the
-- sampled rows never existed here to match against. The card number is identical
-- on both sides and every alternative account scores 1/14.
--
-- pluggy_last_sync = 2026-06-01 so incrementalFromDate() pulls from 2026-05-25.
--
-- EXPECT DUPLICATES in the 2026-05-25 → 2026-06-03 overlap: MeuPluggy issues
-- different transaction ids than the old Nubank item did, so external_id dedup
-- is blind to them (this is exactly what happened on Itaú — see 0037). Run the
-- same (account, date, description, amount) dedup after syncing.

begin;

update accounts
   set pluggy_item_id    = 'f5acd603-8dea-4a67-82c8-64175870e37b',
       pluggy_account_id = '50702abf-4e3a-4ccf-89b8-5464a4449c8a',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = 'f7cd97de-1a9a-459c-b499-eff701acea63';  -- Nu Pagamentos (checking)

update accounts
   set pluggy_item_id    = 'f5acd603-8dea-4a67-82c8-64175870e37b',
       pluggy_account_id = '2f2c1008-d894-4337-9fd9-6307ea8e0014',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = 'a001f8b6-e399-4d7f-a40c-60fa041167ee';  -- ultraviolet-black

commit;
