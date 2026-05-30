# ADR 0001 — Open Finance auto-sync via Pluggy

**Status:** Active — migration applied, credentials set, webhook verified live (≈1s ack)
**Date:** 2026-05-29

## Update (2026-05-30)

The decision below evolved on three points; the original text is kept as the
historical record.

1. **Pluggy is now the *only* import path** — manual OFX/CSV/PDF upload (UI,
   routes, parsers) was removed. Supersedes "alongside (not replacing) manual
   import" in the Decision section.
2. **Synced rows land in an admin acceptance gate, not the portal.** A fresh
   sync inserts rows with `shared_amount = 0` and `status = 'pending_review'`,
   so the household sees nothing until the admin explicitly Accepts (Accept sets
   `shared_amount = real_amount`). Refines "synced rows appear to the household
   once `shared_amount <> 0`" — true, but they start staged at 0.
3. **CC reconciliation is description-based**, not statement-matching: bank
   "PAG FATURA" outflows are marked `is_transfer` + `cartao_pagamento` so they
   aren't double-counted against the itemized card transactions Pluggy delivers.
   The manual "link to CC statement" feature was removed (no statements exist
   under Pluggy-only). The `matchCcPayment` matcher is retained but unused.

## Context

Casa imported transactions only by manual OFX/CSV/PDF upload. Pluggy (Brazil's
Open Finance aggregator) lets a user connect a bank once and have transactions
pulled automatically via API, with categorization and webhooks. Kenlo received a
Pluggy team account; this wires the same capability into the personal app.

## Decision

Add a Pluggy integration alongside (not replacing) manual import:

- **Client** (`lib/pluggy/client.ts`): raw typed REST over `api.pluggy.ai`
  (no SDK). Auth → cached apiKey (2h) → connect token / items / accounts /
  transactions. Keeps the dependency surface to just the front-end widget.
- **Sync** (`lib/pluggy/sync.ts`): one Pluggy *item* (bank login) → one or more
  Casa accounts. Creates the Casa account on first sync, calibrates its starting
  balance so computed balance matches Pluggy's reported balance, pulls 12 months
  on first run / since `pluggy_last_sync` after, dedups on the Pluggy transaction
  id via `transactions.external_id`, then reuses the existing AI categorizer and
  CC reconciler.
- **Routes**: `POST /api/pluggy/{connect-token,items,sync}` (admin, 404 when not
  admin) + `POST /api/pluggy/webhook?token=…` (shared-secret guarded).
- **Front-end**: `react-pluggy-connect` widget behind a "Conectar banco" button
  on `/import` (admin only), dynamically imported (`ssr:false`).

### Dual-ledger integrity
Pluggy fills the **real** ledger (`real_amount = shared_amount = signed amount`).
The admin still curates `shared_amount`/hide as before. `shared_transactions_v`
does **not** filter by `source`, so synced rows appear to the household once
`shared_amount <> 0` — the privacy wall is unchanged.

## Schema (migration `db/migrations/0004_pluggy.sql`)
- `tx_source` enum gains `'pluggy'`.
- `accounts` gains `pluggy_item_id`, `pluggy_account_id`, `pluggy_last_sync`.
- Unique partial index `ux_tx_pluggy(account_id, external_id) WHERE source='pluggy'`
  for DB-level dedup.

## Activation (two manual steps)
1. Run `db/migrations/0004_pluggy.sql` in the Supabase SQL editor.
2. Set `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` (and optionally
   `PLUGGY_WEBHOOK_SECRET`) in Vercel env, from `dashboard.pluggy.ai`.
   Then point a Pluggy webhook at
   `https://<app>/api/pluggy/webhook?token=<PLUGGY_WEBHOOK_SECRET>`.

## Consequences / open risks (not runtime-tested against live Pluggy)
- **Amount sign**: derived from `type` (DEBIT→negative, CREDIT→positive), else
  the value Pluggy already signed. Verify against a real connector — credit-card
  sign conventions vary.
- **Categorization cost**: each sync runs the Gemini batch on new rows. Fine for
  one household; revisit if volume grows.
- **Sandbox**: the widget passes `includeSandbox` so test banks appear — remove
  for a real-only experience.
