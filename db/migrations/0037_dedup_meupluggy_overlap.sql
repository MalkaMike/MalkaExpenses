-- 0037 — Remove the duplicate rows the MeuPluggy re-connection imported.
--
-- Why: migration 0036 re-pointed the Itaú accounts at the new MeuPluggy item and
-- set pluggy_last_sync = 2026-06-01, so the sync pulled from 2026-05-25 (the
-- 7-day overlap incrementalFromDate() applies). The overlap is normally free,
-- because syncPluggyItem dedups on transactions.external_id = the Pluggy
-- transaction id. But MeuPluggy issues DIFFERENT transaction ids for the same
-- underlying purchases than the old Itaú item did, so the dedup could not see
-- them and 2026-05-25 → 2026-06-03 was imported a second time. A handful of
-- future-dated credit-card instalments were duplicated the same way.
--
-- Effect if left alone: 107 double-counted transactions, silently wrong balances
-- on Itau, The One and LATAM Pass Black (1827).
--
-- Matching is deliberately conservative: rows are paired 1:1 on
-- (account_id, date, description_raw, real_amount) using row_number(), so a
-- genuine repeat charge (two identical IOF lines on one day, say) is preserved.
-- Only as many new rows are removed as there are older twins.
--
-- Reversible: every deleted row is copied to transactions_dup_backup_0037 first.
-- Verified before running: 107 rows matched, 0 referenced by nota_fiscais,
-- 0 referenced by transaction_reimbursements.

begin;

create table if not exists transactions_dup_backup_0037 (like transactions including all);

with ranked as (
  select t.id, t.account_id, t.date, t.description_raw, t.real_amount,
         (t.created_at > '2026-08-19') as is_new,
         row_number() over (
           partition by t.account_id, t.date, t.description_raw, t.real_amount,
                        (t.created_at > '2026-08-19')
           order by t.id
         ) as rn
  from transactions t
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
insert into transactions_dup_backup_0037
select * from transactions where id in (select id from dupes);

delete from transactions
 where id in (select id from transactions_dup_backup_0037);

commit;

-- Restore, if this ever proves wrong:
--   insert into transactions select * from transactions_dup_backup_0037;
