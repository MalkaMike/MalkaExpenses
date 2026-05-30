# Onboarding — Day 1

Goal: understand and run Casa in under 30 minutes.

## 1. Read these, in order (10 min)
1. `README.md` — what it is, setup, the security wall.
2. `docs/architecture.md` — the dual ledger, auth, Pluggy flow, acceptance gate.
3. `docs/GLOSSARY.md` — domain terms (real vs shared ledger, staged, etc.).
4. `docs/adr/0001-pluggy-open-finance.md` — why/how Open Finance was added.

## 2. Run it locally (10 min)
```
npm install
cp .env.example .env.local   # fill from Vercel project env (ask Mickael)
npm run dev                  # http://localhost:3000
npm run typecheck && npm test
```
The migrations (`db/migrations/0001..0004`) are already applied to the shared
Supabase project; you don't re-run them unless you spin up your own.

## 3. Trace one request (10 min)
Follow a synced transaction end-to-end:
- `lib/pluggy/sync.ts` → inserts staged (`shared_amount=0`).
- `app/admin/inbox/` → admin Accepts → `PATCH /api/transactions/[id]`.
- `lib/supabase/shared-client.ts` + `shared_transactions_v` (in `0001_init.sql`)
  → why the household can't see staged/hidden rows.
- `app/page.tsx` + `lib/dashboard/queries.ts` → the role branch (view vs table).

## Key files
| Area | File |
|---|---|
| Auth gate | `middleware.ts`, `lib/auth/admin.ts` |
| Security wall | `lib/supabase/shared-client.ts`, view in `db/migrations/0001_init.sql` |
| Open Finance | `lib/pluggy/{client,mappers,sync}.ts`, `app/api/pluggy/*` |
| Acceptance gate | `app/admin/inbox/*`, `app/api/transactions/[id]/route.ts` |
| Archive / take-out | `app/admin/archive/*`, `app/transactions/transactions-client.tsx` |
| Balances | `lib/balance/*` (pure, unit-tested) |
| AI | `lib/ai/categorize.ts` |

## Golden rules
- Never let a household/shared path touch `real_amount`, `is_fake`,
  `notes_private`, or the `transactions` table directly. Use the view.
- New synced data must stage (`shared_amount=0`) — never auto-show.
- No `console.log` outside tests, no silent `.catch(()=>{})`, no hardcoded
  secrets. `npm run typecheck` + `npm test` must pass before push.

## Activation gotchas (Open Finance)
- Real banks need Pluggy **production** access (KYB + plan + approval). Dev =
  sandbox banks only. Then swap `PLUGGY_CLIENT_ID/SECRET` in Vercel — no code.
- `ALTER TYPE ... ADD VALUE` (migration 0004) must commit before its enum value
  is used — run it as its own statement, then the columns/indexes.
