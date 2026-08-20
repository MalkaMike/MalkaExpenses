-- 0041 — Stop DELETING re-connection duplicates; mark them is_fake instead.
--
-- What went wrong with 0037/0038: they deleted the duplicate rows. But
-- syncPluggyItem builds its dedup set by reading the external_id of rows already
-- in `transactions`. Deleting a row removes its external_id from that set, so
-- the very next sync imports it again. Proof: after the Nubank sync of
-- 2026-08-20 19:45, **17 of the 108 rows deleted by 0037/0038 were back**, and
-- 0040 then failed on a unique-key clash while trying to back them up twice.
-- Deleting duplicates from a live Pluggy feed is self-undoing.
--
-- The fix: keep the row, set is_fake = true. That is already this app's meaning
-- for "not a real movement" — the 1,001 existing is_fake rows are duplicates of
-- exactly this kind, sitting in the duplicate accounts. Balance and dashboard
-- queries all sum over is_fake = false (lib/balance/queries.ts,
-- lib/dashboard/queries.ts, app/accounts/[id]/page.tsx), so a fake row affects
-- no total — while its external_id stays present and blocks re-import forever.
--
-- This migration:
--   1. restores every backed-up row that is no longer in `transactions`,
--      inserted straight away as is_fake = true;
--   2. flags the ones that already crept back;
--   3. flags the duplicates from the Nubank batch that 0040 never got to.
--
-- transactions_dup_backup_0037 is kept as the record of what was touched.

begin;

-- 1. Put back what 0037/0038 removed, inert.
--    Guard on BOTH the primary key and the ux_tx_pluggy unique key
--    (account_id, external_id): the sync re-created some of these rows under a
--    fresh id, so an id-only guard still collides.
insert into transactions
select * from transactions_dup_backup_0037 b
 where not exists (select 1 from transactions t where t.id = b.id)
   and not exists (
     select 1 from transactions t
      where t.account_id = b.account_id
        and t.external_id is not distinct from b.external_id
   );

update transactions t
   set is_fake = true
  from transactions_dup_backup_0037 b
 where t.id = b.id;

-- 2. Any row the sync re-created under a NEW id but matching a backed-up
--    (account_id, external_id) pair is the same duplicate wearing a new id.
update transactions t
   set is_fake = true
  from transactions_dup_backup_0037 b
 where t.account_id = b.account_id
   and t.external_id = b.external_id
   and t.is_fake = false;

-- 3. The Nubank batch's own duplicates (created_at > 2026-08-20 19:45),
--    paired 1:1 against older twins so genuine repeat charges survive.
with ranked as (
  select t.id, t.account_id, t.date, t.description_raw, t.real_amount, t.is_fake,
         (t.created_at > '2026-08-20 19:45') as is_new,
         row_number() over (
           partition by t.account_id, t.date, t.description_raw, t.real_amount,
                        (t.created_at > '2026-08-20 19:45')
           order by t.id
         ) as rn
  from transactions t
  where t.is_fake = false
),
dupes as (
  select n.id
  from ranked n
  join ranked o
    on  o.account_id      = n.account_id
    and o.date            = n.date
    and o.description_raw = n.description_raw
    and o.real_amount     = n.real_amount
    and o.is_new          = false
    and o.rn              = n.rn
  where n.is_new = true
)
update transactions set is_fake = true where id in (select id from dupes);

commit;
