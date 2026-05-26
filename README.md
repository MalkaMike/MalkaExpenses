# Casa — Personal Finance (Dual Ledger)

Private household finance app with two parallel books:
- **Real ledger** (Mickael only): every transaction as it actually happened.
- **Shared ledger** (visible to wife): same transactions but with editable amounts; some hidden, some fake entries added. The shared balance is always the honest sum of what's shown.

A PIN-gated "private mode" cookie flips between views. The default view is the shared one — if the phone is borrowed, there's no visible affordance hinting at the second mode.

## Status

**v0.1 — Foundation.** Ships:
- Postgres schema with the `shared_transactions_v` security-wall view
- PIN auth + sliding-window private-mode cookie (15 min idle timeout)
- Middleware that returns 404 on `/private/*` and `/api/private/*` when not unlocked
- OFX statement upload + parse + preview + confirm import
- Accounts CRUD (manual via form)
- Mobile-first shared and private views with computed balances
- Long-press logo (3s) → unlock page

Coming next: v0.2 Claude categorization + review queue, v0.3 PDF + CSV + CC reconciliation, v0.4 fake entry UI + monthly charts, v0.5 PWA polish.

## Setup

### 1. Supabase

Create a new Supabase project (use a personal, isolated one — not anything tied to Kenlo).

In the SQL editor, run [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql). This creates the tables, the `shared_transactions_v` view, and enables RLS on every table (so anon/authenticated roles cannot read anything — only the server-side service-role key can).

Create a Storage bucket named `statements` (private).

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MODE_COOKIE_SECRET=     # generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ANTHROPIC_API_KEY=      # optional in v0.1
GOOGLE_GENAI_API_KEY=   # optional in v0.1
```

### 3. Run

```
npm install
npm run dev
```

Open http://localhost:3000.

First time: long-press the logo (3 seconds) → set a PIN → you're in private mode.

### 4. Tests

```
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Architecture

The single most important rule: **shared-view code paths must never read `real_amount`, `is_fake`, or `notes_private`.** This is enforced three ways:

1. **`shared_transactions_v`** — a Postgres VIEW that excludes those columns and any row with `shared_amount = 0`. Hidden transactions don't even exist from the shared side's perspective.
2. **`lib/supabase/shared-client.ts`** — a runtime wrapper that throws if shared code tries to query `transactions` directly or select forbidden columns by name.
3. **Middleware (`middleware.ts`)** — gates every `/private/*` and `/api/private/*` route on the `pf_mode` cookie. Returns 404 (not 401/403) when missing — no signal the route exists.

The dual-ledger math lives in [`lib/balance/monthly.ts`](lib/balance/monthly.ts) (pure functions with unit tests).

## Privacy threat model

The threat is the wife borrowing an unlocked phone. She sees:
- The shared dashboard (account names, shared balances, all visible transactions, monthly totals).
- No menu item, no lock icon, no "switch user" link, no URL path that hints at a second mode.
- If she pokes at `/private` or `/api/private/...` directly: 404 Not Found.

She does **not** see:
- `real_amount`, `is_fake`, or `notes_private` in any HTML or API response.
- Any account-level balance computed from real data — every balance shown to her is the honest sum of `shared_amount` values.

The integration leak-guard test (`app/api/shared/__tests__/no-leak.test.ts`, landing in v0.2) hits every shared route and grep-asserts the response body. If it ever fails, deploy is blocked.

## File map

```
app/
  layout.tsx                # root layout; reads getMode() and renders banner
  page.tsx                  # home — accounts list with shared (and real, if unlocked) balances
  transactions/             # transaction list, dual-aware
  accounts/[id]/            # account detail
  accounts/new/             # create-account form
  import/                   # statement upload + parse preview
  months/                   # monthly totals
  unlock/                   # PIN entry (reached only via long-press)
  api/
    accounts/               # POST create account
    import/upload/          # multipart upload + OFX parse
    import/confirm/         # batch insert into transactions
    mode/{enter,exit,setup-pin}/

components/
  brand-logo.tsx            # long-press handler → /unlock
  mode-banner.tsx           # red banner + exit, only in private mode
  transaction-row.tsx       # dual-amount-aware row

lib/
  env.ts                    # zod-validated env
  format.ts                 # BRL + date formatting
  auth/mode.ts              # PIN, cookie, audit log
  supabase/server.ts        # service-role server client
  supabase/shared-client.ts # the runtime security guard
  parsers/ofx.ts            # hand-rolled OFX parser
  balance/queries.ts        # accounts + balances from DB
  balance/monthly.ts        # pure balance math (unit tested)

middleware.ts               # 404 gate on /private/* and /api/private/*
db/migrations/0001_init.sql # schema + shared_transactions_v + RLS
```

## License

Private.
