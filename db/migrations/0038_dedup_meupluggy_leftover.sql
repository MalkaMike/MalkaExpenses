-- 0038 — Remove the one duplicate that survived 0037.
--
-- 0037 pairs old and new rows 1:1, which is right when the new import delivers
-- one copy of a charge the ledger already had. This charge came through TWICE
-- in the MeuPluggy import, so the partition held 1 old + 2 new: 0037 removed one
-- and left the ledger with 1 old + 1 new — still one copy too many.
--
--   "ANACA ESTUDIO - JARDIN", The One, 2026-05-31, R$ 539,10
--     old  90608fb8… created 2026-06-04, status user_edited   (curated, keep)
--     new  c283173e… created 2026-08-20, status auto_accepted (remove)
--
-- Keeping the older row: it is the one Mickael already reviewed (user_edited),
-- and the pre-existing ledger recorded exactly one charge that day.
-- Backed up to the same table as 0037, so this stays reversible.

begin;

insert into transactions_dup_backup_0037
select * from transactions
 where id = 'c283173e-8f3f-42fd-a278-b40cff00d277';

delete from transactions
 where id = 'c283173e-8f3f-42fd-a278-b40cff00d277';

commit;
