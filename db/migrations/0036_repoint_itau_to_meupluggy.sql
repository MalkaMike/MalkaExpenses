-- 0036 — Re-point the Itaú accounts at the new MeuPluggy connection.
--
-- Why: the app's Pluggy key sits in an expired trial workspace and can no longer
-- refresh real bank items. Pluggy's copy of the Itaú data froze on 2026-06-03
-- and the daily sync has been re-reading that frozen copy ever since, reporting
-- success while importing nothing (see item/2026-08-19 investigation).
--
-- Fix: the same key CAN read connector 200 (MeuPluggy), the personal aggregator
-- where the banks are actually connected and current. A new item was created for
-- it on 2026-08-19: 8eea26ed-a6ee-4e86-9aef-4b6efd43005f.
--
-- This migration points the four EXISTING Itaú accounts at that new item instead
-- of letting syncPluggyItem's "find or create" branch mint duplicates. Without
-- it, the next sync would create four new account rows and re-import 12 months
-- of transactions alongside the 6,646 already stored — doubling every balance.
--
-- pluggy_last_sync is set to 2026-06-01 so incrementalFromDate() pulls from
-- 2026-05-25 (7-day overlap) forward: the whole gap, and nothing older.
--
-- Mapping was verified by transaction overlap, NOT by account name — the names
-- and card numbers differ between the two systems. Each new account's Apr–May
-- 2026 transactions were matched on (date, amount) against the existing ledger:
--   itau 00010532-9  -> "Itau"                    50/50 sampled rows matched
--   LATAM BLACK 7561 -> "LATAM Pass Black (1827)" 50/50  (the "(7427)" row: 44/50)
--   THE ONE 1754     -> "The One"                 51/50  (archived twin:     43/50)
--   VISA INFINITE 5044 -> "Visa Infinite (5044)"  no transactions on either side;
--                                                 matched on card number alone.
--
-- Not touched here: the duplicate rows "LATAM Pass Black (7427)",
-- "PERSONNALITE LATAM PASS VISA INFINITE" and the archived
-- "ITAU PERSONNALITE THE ONE". They predate this work and are a separate cleanup.
-- Nubank, Porto Bank and Bradesco are not covered — each needs its own MeuPluggy
-- connection, done one bank at a time.

begin;

update accounts
   set pluggy_item_id    = '8eea26ed-a6ee-4e86-9aef-4b6efd43005f',
       pluggy_account_id = 'e458b0df-f8a2-4d52-b361-22e7c8eb315d',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = 'db3a27a1-1eb0-455b-a037-ae9318901274';  -- Itau (checking)

update accounts
   set pluggy_item_id    = '8eea26ed-a6ee-4e86-9aef-4b6efd43005f',
       pluggy_account_id = '11771789-00d1-4fde-b709-b47af25d0567',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = 'bc9c7ad2-315a-4275-ae0f-61ab12a17e58';  -- The One

update accounts
   set pluggy_item_id    = '8eea26ed-a6ee-4e86-9aef-4b6efd43005f',
       pluggy_account_id = '30f300b7-cd8c-4d72-b865-95cbcc310c22',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = '634303db-d38d-409f-a325-573f795ad8bc';  -- LATAM Pass Black (1827)

update accounts
   set pluggy_item_id    = '8eea26ed-a6ee-4e86-9aef-4b6efd43005f',
       pluggy_account_id = 'c299edc1-c2c0-4793-a1f0-bed5f075b4af',
       pluggy_last_sync  = '2026-06-01T00:00:00Z'
 where pluggy_account_id = 'a1bf818f-eea2-4944-91c0-03b05f365122';  -- Visa Infinite (5044)

commit;

-- Result check (run after): every row below must show the new item id.
-- select name, pluggy_item_id, pluggy_account_id, pluggy_last_sync
--   from accounts where pluggy_item_id = '8eea26ed-a6ee-4e86-9aef-4b6efd43005f';
