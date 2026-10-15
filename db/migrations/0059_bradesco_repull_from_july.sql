-- 0059_bradesco_repull_from_july.sql
--
-- Mickael, 2026-10-15: "then do the sync fix and the 4 missing Bradesco rows".
--
-- Four Bradesco rows of 10–14/07/2026 are in Pluggy but were never pulled:
-- the sync looked back only 7 days and these arrived later (measured
-- 2026-10-15: July property tax −R$888,40, insurance −R$2,86, interest
-- R$0,01, own-account Pix +R$1.000,00). Nothing in the app is a copy of them.
--
-- Instead of hand-writing the rows (their bank text carries reference
-- numbers we keep out of git), this moves the Bradesco account's last-sync
-- stamp back to 2026-08-24. With the new 45-day overlap the next sync pulls
-- from 2026-07-10, the id dedup skips everything already here, and the four
-- rows go in through the normal path (categorised like any new row). The
-- sync sets the stamp to "now" again when it finishes.

CREATE TABLE IF NOT EXISTS snapshot_0059_bradesco_last_sync AS
SELECT id, pluggy_last_sync, now() AS taken_at
FROM accounts
WHERE name = 'Banco Bradesco' AND is_archived = false AND pluggy_item_id IS NOT NULL;

ALTER TABLE snapshot_0059_bradesco_last_sync ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT count(*) FROM snapshot_0059_bradesco_last_sync) <> 1 THEN
    RAISE EXCEPTION '0059: expected exactly one live Bradesco account';
  END IF;
END $$;

UPDATE accounts a
SET pluggy_last_sync = '2026-08-24T00:00:00Z'
FROM snapshot_0059_bradesco_last_sync s
WHERE a.id = s.id;

-- ---------------------------------------------------------------------------
-- ROLLBACK (only meaningful before the next sync runs):
--
-- UPDATE accounts a SET pluggy_last_sync = s.pluggy_last_sync
-- FROM snapshot_0059_bradesco_last_sync s WHERE a.id = s.id;
-- DROP TABLE snapshot_0059_bradesco_last_sync;
-- ---------------------------------------------------------------------------
