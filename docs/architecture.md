# Architecture — Casa

Next.js 15 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Storage)
· Vertex/Gemini · Vercel. Mobile-first, light theme ("Luminous Clarity").

## The core idea: a dual ledger behind a one-way wall

```
                         transactions table (the truth, admin only)
                         ├─ real_amount      ← what actually happened
                         ├─ shared_amount    ← what the household sees (0 = hidden/staged)
                         ├─ is_fake          ← entry that isn't real but shown
                         └─ notes_private    ← admin-only memo
                                  │
                 ┌────────────────┴───────────────────┐
        ADMIN path                              HOUSEHOLD path
        serverClient() → transactions           sharedClient() → shared_transactions_v
        (sees real_amount, everything)          (real_amount/is_fake/notes_private
                                                  excluded; rows with shared_amount=0
                                                  filtered out entirely)
```

`shared_transactions_v` is the **security wall**. The household never queries the
table — only the view — so it physically cannot receive hidden truth.

## Auth — three roles, two cookies

| Role | Cookie | Sees |
|---|---|---|
| `public` | none | only `/login`, `/admin` login screens |
| `household` | `pf_household` (HMAC, 90d) | the portal (curated/shared data) |
| `admin` | `pf_admin` (HMAC, sliding 60min) | everything incl. `/admin/*`, real ledger |

`middleware.ts` enforces it at the edge. Passwords are bcrypt hashes in env
(`ADMIN_PASSWORD_HASH`, `HOUSEHOLD_PASSWORD_HASH`); cookies signed with
`MODE_COOKIE_SECRET`. Threat model: the wife borrows the (household-logged-in)
phone and finds no affordance, no balance, no API response hinting at a second
ledger. Admin-only concerns (the inbox, alerts) are never shown to household.

## Data in: Open Finance (Pluggy), the only import path

```
Pluggy Connect widget (/import) → bank login (inside Pluggy, we never see creds)
  → Item created → webhook (/api/pluggy/webhook?token=) OR daily cron
  → lib/pluggy/sync.ts: items → Casa accounts (auto-created, balance calibrated),
    pull transactions (12mo first, incremental w/ 7d overlap, dedup on external_id)
  → insert STAGED: shared_amount=0, status=pending_review
  → categorize: CC-payment→transfer (deterministic) · merchant rules · Gemini batch
```

`lib/pluggy/client.ts` (typed REST, no SDK) + `lib/pluggy/mappers.ts` (pure,
unit-tested). Routes: `connect-token`, `items`, `sync` (admin), `webhook`
(token-guarded), `/api/cron/pluggy-sync` (CRON_SECRET, daily 06:00 UTC).

## The acceptance gate (the admin's daily surface)

Synced rows are staged (`shared_amount=0` → invisible). The admin works
`/admin/inbox`:
- **Accept** → `shared_amount = real_amount` (shows the real value in the portal)
- **Adjust** → custom `shared_amount`
- **Hide** → stays 0 (real-only) → lands in `/admin/archive`, restorable
- **Add entry** → manual or fake (`is_fake`, `real_amount=0`) portal entry

Category is chosen at acceptance (AI pre-fills). Taking an accepted item out
later = one tap on the transactions list (hide → archive → restore).

## Other subsystems
- **AI categorization** — `lib/ai/categorize.ts` (Gemini batch); merchant rules
  learned on confirmation; three-tier confidence.
- **CC double-count protection** — `lib/reconciliation` marks bank "PAG FATURA"
  outflows as transfers (statement matcher in `cc-matcher.ts` kept for future).
- **Balances** — `lib/balance/*` pure functions; admin uses real, household uses
  shared, both = starting_balance + Σ(amounts).
- **i18n** — cookie-based PT/EN (`lib/i18n`); currency/dates stay pt-BR.
- **PWA** — `app/manifest.ts` + `public/sw.js`.

## Migrations
`0001` schema + view + RLS · `0002` view+category_slug · `0003` budgets/goals/
snapshots · `0004` Pluggy (tx_source enum, accounts.pluggy_*, dedup index).

## Invariants (never break)
1. Household responses never contain `real_amount` / `is_fake` / `notes_private`.
2. A row with `shared_amount = 0` is invisible to the household (view + balances).
3. Synced data is staged until the admin accepts — nothing auto-reaches the portal.
