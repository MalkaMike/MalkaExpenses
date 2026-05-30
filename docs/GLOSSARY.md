# Glossary — Casa

**Real ledger** — the truth. `transactions.real_amount`. Admin only. Every
transaction as it actually happened.

**Shared ledger** — what the household sees. `transactions.shared_amount`.
Curated by the admin. The portal balance is always the honest sum of these.

**Dual ledger** — the two together. Same rows, two amount columns. The admin
curates `shared_amount`; the math follows.

**Staged** — a synced transaction with `shared_amount = 0` and
`status = 'pending_review'`. Real (admin sees it) but invisible to the household,
waiting in the acceptance inbox.

**Acceptance gate / inbox** (`/admin/inbox`) — where staged transactions wait.
The admin decides per row what the household sees.

**Accept** — set `shared_amount = real_amount`; the row appears in the portal.
**Adjust** — set a custom `shared_amount` (show partial). **Hide** — keep
`shared_amount = 0`; real-only, lands in the archive.

**Take out** — hide an already-shown transaction (remove from the portal). The
real row is never deleted; it goes to the **archive** (`/admin/archive`),
**restorable**.

**Fake entry** — a row that isn't real but is shown to the household
(`is_fake = true`, `real_amount = 0`, `shared_amount > 0`). Created via "Add entry".

**Transfer** (`is_transfer`) — an internal movement (e.g. a credit-card bill
payment) excluded from category/spend totals so it doesn't double-count.

**Security wall** — `shared_transactions_v`, the Postgres view the household path
must use. Excludes `real_amount`, `is_fake`, `notes_private`; filters out
`shared_amount = 0` rows.

**Roles** — `public` (anonymous), `household` (`pf_household` cookie, sees the
portal), `admin` (`pf_admin` cookie, sees the real ledger + `/admin/*`).

**Open Finance / Pluggy** — Brazil's bank-aggregation API. Connects a bank via
the **Connect widget**, returns an **Item** (one bank login) exposing **accounts**
and **transactions**. Pluggy is the only import path — manual OFX/CSV/PDF upload
was removed. Synced rows land **Staged** in the **Acceptance gate / inbox**.

**Item** — a Pluggy connection (one bank login). One Item → one or more Casa
accounts (`accounts.pluggy_item_id` / `pluggy_account_id`).

**Webhook** — Pluggy POSTs to `/api/pluggy/webhook?token=…` when an item/its
transactions change; triggers a sync. A daily cron does the same defensively.

**Merchant rule** — a learned pattern → category mapping
(`merchant_rules`), created when the admin corrects a category; future matching
transactions skip the AI.

**Sandbox vs production (Pluggy)** — sandbox = fake test banks (current). Real
banks require Pluggy production access (commercial + KYB approval).
