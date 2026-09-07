# Casa — Personal Finance (Dual Ledger)

Private household finance app with two parallel books:

- **Real ledger** (admin only): every transaction as it actually happened (`real_amount`).
- **Shared ledger** (household sees): the same transactions with curated amounts —
  some hidden, some adjusted, some fake entries added (`shared_amount`). The shared
  balance is always the honest sum of what's shown.

Bank data flows in automatically via **Open Finance (Pluggy)**. Every synced
transaction lands in an **admin acceptance inbox** first, invisible to the
household, until the admin accepts / hides / adjusts it.

Live: **https://malkafinance.vercel.app**

## Status

Feature-complete and deployed, with **real bank data flowing**.

> ⚠️ **Superseded 2026-08-30.** This section used to say Open Finance was "live in
> sandbox" and that real banks needed Pluggy production approval. That has not been
> true for some time. Measured 2026-08-30:
> `select count(*), min(date), max(date), count(distinct account_id) from transactions where source = 'pluggy'`
> → **6,337 rows across 9 accounts, 2025-06-03 to 2027-06-28** (82% of the 7,706-row
> ledger; the 2027 dates are future instalments Pluggy books in advance).

Real banks are read through **MeuPluggy** (Pluggy connector 200), the personal
aggregator where the accounts are actually connected — not through a direct
per-bank item. The app's own Pluggy key sits in an expired trial workspace and can
no longer refresh direct bank items, which is why the accounts were re-pointed at
the MeuPluggy connection on 2026-08-19. Background and the mapping evidence:
`db/migrations/0036_repoint_itau_to_meupluggy.sql`. Original design decision:
`docs/adr/0001-pluggy-open-finance.md`.

## How it works (one paragraph)

Pluggy Connect widget → bank login → `Item` → webhook/cron → `lib/pluggy/sync`
pulls accounts + transactions into the `transactions` table with
`shared_amount = 0` (staged, invisible to the household). The admin works the
**`/admin/inbox`** acceptance gate: Accept (show real), Adjust (show custom),
Hide (keep private), or Add a manual/fake entry. Accepted rows (`shared_amount ≠ 0`)
appear in the household portal through the `shared_transactions_v` view. Anything
later taken out goes to **`/admin/archive`**, restorable.

## Setup

### 1. Supabase
Create a personal, isolated project. In the SQL editor run, in order:
`db/migrations/0001_init.sql` → `0002_view_category_slug.sql` →
`0003_budgets_goals_snapshots.sql` → `0004_pluggy.sql`.
Create a private Storage bucket named `statements` (legacy; harmless).

### 2. Environment
Copy `.env.example` → `.env.local` and fill in (see that file for comments):
Supabase keys, `ADMIN_PASSWORD_HASH` + `HOUSEHOLD_PASSWORD_HASH` (bcrypt),
`MODE_COOKIE_SECRET`, AI keys (`GOOGLE_GENAI_API_KEY` / Vertex), and — to enable
Open Finance — `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_WEBHOOK_SECRET`,
`CRON_SECRET`.

### 3. Run / verify
```
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # production build
```

### 4. Deploy
Push to `main` → Vercel auto-deploys (project `malkafinance`). Env vars live in
Vercel (Production). After adding Pluggy vars, register the webhook by hitting
`/api/debug/pluggy-webhook-ensure` once (admin-gated) — it creates/repairs the
Pluggy webhook via their API with the shared secret in an `X-Webhook-Secret`
header (Pluggy's dashboard can only set a bare url, not custom headers, so a
`?token=` query string is not used — that would ride in plaintext through
access logs).

## The security wall (most important rule)

**Household code paths must never read `real_amount`, `is_fake`, or
`notes_private`.** Enforced in layers:

1. **`shared_transactions_v`** — Postgres view that excludes those columns and any
   row with `shared_amount = 0`. Staged/hidden transactions don't exist from the
   household side.
2. **`lib/supabase/shared-client.ts`** — runtime guard; throws if shared code
   queries the `transactions` table directly or selects a forbidden column.
3. **`middleware.ts`** — two-tier auth gate. `/admin/*` + `/api/admin/*` require
   the `pf_admin` cookie; everything else requires `pf_household` or `pf_admin`;
   API routes 404 (not 401) when unauthorized. Public machine endpoints
   (`/api/pluggy/webhook`, `/api/cron/*`) are exempt — they self-auth with secrets.
4. **Role-gated reads** — every page that shows data branches: non-admin →
   `shared_transactions_v`; admin → `transactions` (real). API responses to
   household are sanitized to the safe fields only.

See `docs/architecture.md` for the full system overview and `docs/GLOSSARY.md`
for domain terms.

## License
Private.
