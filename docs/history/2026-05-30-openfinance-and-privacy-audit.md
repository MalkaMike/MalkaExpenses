---
date: 2026-05-30
project: Casa (personal finance dual-ledger)
status: shipped
---

# Open Finance activation + privacy-wall audit

Session log for the arc that took Casa from "Pluggy integration coded" to
"Open Finance live in sandbox, privacy wall re-verified."

## What shipped

### Light theme ("Luminous Clarity")
- Flipped the app to the curated Stitch light theme via `globals.css` tokens
  (whole UI re-themes from one file). Bank-brand account tiles, budget status
  badges, tinted insight cards, signed amounts, restyled KPI cards.

### Open Finance (Pluggy) — built then made the only import path
- `lib/pluggy/{client,mappers,sync}.ts`: typed REST client (auth cache,
  connect token, items, accounts, transactions), pure mappers (9 unit tests),
  sync engine (item → Casa accounts, 12-mo first pull, incremental w/ 7-day
  overlap, external_id dedup, reuses AI categorizer).
- Routes: `/api/pluggy/{connect-token,items,sync}` (admin), `/webhook`
  (token-guarded), `/api/cron/pluggy-sync` (daily, CRON_SECRET).
- Removed manual OFX/CSV/PDF import entirely (UI + routes + parsers).

### Admin acceptance gate (the dual-ledger control)
- Synced transactions arrive **staged** (`shared_amount=0` → invisible to the
  household via `shared_transactions_v`), `status=pending_review`.
- `/admin/inbox`: per-row Accept (show real) / Adjust (custom) / Hide / category;
  bulk accept; "Add entry" (manual/fake) via `POST /api/transactions`.
- First-sync sets shared starting balance to 0 (no real-total leak).

### Take-out + restorable archive
- One-tap "tirar do portal" (hide) on the transactions list; `/admin/archive`
  lists removed items with restore + permanent-delete. Nothing is ever lost.

## Live activation (browser + CLI)
- Created Pluggy "Casa" dev app; set `PLUGGY_CLIENT_ID/SECRET`,
  `PLUGGY_WEBHOOK_SECRET`, `CRON_SECRET` in Vercel (encrypted).
- Applied migration `0004_pluggy.sql` in Supabase SQL editor (enum + columns
  + indexes). **Caught a stale "Success" — the columns hadn't actually applied
  on the first run; re-ran with the Run button.**
- Registered the `all`-event webhook (HTTP 200).
- **Middleware bug caught by live test:** the cookie gate 404'd the public
  webhook + cron endpoints → exempted them (they self-auth via secrets).
- End-to-end proof: sandbox Pluggy Bank item → webhook → sync →
  **10 transactions, all staged, 0 leaked to portal**. Cleaned up after.
- Real banks remain gated behind Pluggy's commercial/KYB approval (Mickael's
  move). Then it's a 1-env-var swap to production credentials, no code.

## Privacy-wall audit (the invariant: household never sees hidden truth)
Verified `shared_transactions_v` (excludes real_amount/is_fake/notes_private,
filters shared_amount<>0), the `sharedClient` runtime guard, and every
household-reachable page (dashboard, transactions, categories, budgets, months,
accounts/[id]) — all correctly route non-admin reads through the view.

Two real issues found + fixed:
1. **PATCH `/api/transactions/[id]` leaked the full row** (real_amount, is_fake,
   notes_private) to household callers editing a category. Now sanitized for
   non-admins.
2. **AlertsBell + `/api/health/alerts` were shown to household** — a tell that
   a hidden ledger exists. Gated to admin-only (404 for others).
Plus a functional fix: household "sair" always hit the admin logout → couldn't
log out.

## Follow-up hardening (same day)
- **Loading skeletons**: every route is `force-dynamic`, so navigation blanked
  until the server responded. Added a shared `PageSkeleton` (finance-list shape)
  + `loading.tsx` for home/transactions/categories/budgets/admin-inbox.
- **Dead-code removal (Pluggy-only)**: `statement_imports` never populates now,
  so three surfaces were dead + misleading — removed: the edit-modal "link to CC
  statement" picker, `GET /api/reconcile` + its manual-link `POST` branch, and
  the `failed_imports` alert. Kept the description-based reconcile auto-scan, the
  "mark as transfer" checkbox, and pending_review/missing_months alerts.
- **Leak-guard test**: extracted the pure `assertSafeTable`/`assertSafeColumns`
  predicates from `shared-client.ts` into `lib/supabase/guard.ts` and locked them
  with 7 unit tests (forbidden tables/columns throw; the shared view + safe
  columns pass; `shared_amount` can't be mistaken for `real_amount`). The runtime
  backstop had no coverage before. **42 tests total** (was 35).
- **Privacy wall re-verified end-to-end** after the changes: traced every read of
  `real_amount`/`is_fake`/`notes_private` across app+components — all admin-gated
  or behind the view. No new leaks. `next build` ✓.
- **Docs reconciled** with Pluggy-only reality: ADR-0001 Update section (status
  Active, only import path, acceptance-gate staging, description-based reconcile)
  + GLOSSARY Pluggy entry.

## Still open (not blocking)
- Pluggy production access (commercial/KYB — Mickael), then a 1-env-var swap.
- Deferred until real data exists (premature now — ~zero rows): LLM "Smart Facts"
  insights, N+1 → batched queries, SQL/materialized aggregation, net-worth
  snapshot cron. DB-enforced RLS wall is also deferred (needs a household-login
  verification step that can't be done safely without the live cookie).
