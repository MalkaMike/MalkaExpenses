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
npx vercel login && npx vercel link
npx vercel env pull .env.local --environment=production
npm run dev                  # http://localhost:3000
npm run typecheck && npm test
```

**Two traps, both cost an afternoon on 2026-08-13. There is no `.env.example`;
this is the procedure.**

1. **`vercel env pull` cannot return the secrets.** Variables marked *Sensitive*
   in Vercel come back as the literal string `[SENSITIVE]` — 11 characters,
   for the owner too, with any flag. Everything still boots, then every check
   fails for no visible reason. Get the real values from their sources instead:
   - Supabase URL + `anon` + `service_role`: the Supabase dashboard, or
     `GET https://api.supabase.com/v1/projects/<ref>/api-keys?reveal=true`
     with a `SUPABASE_ACCESS_TOKEN`.
   - `MODE_COOKIE_SECRET`, `CRON_SECRET`, the `*_PASSWORD_HASH` values: these
     do **not** have to match production locally. Generate your own — any 32+
     char random string, and `bcrypt.hashSync("<your password>", 10)` for a
     hash. Note the secretary link at `/celina/<token>` is derived from
     `MODE_COOKIE_SECRET`, so your local link differs from the real one.

2. **Escape every `$` in `.env.local` as `\$`.** Next's env loader expands
   `$VAR`, and a bcrypt hash is `$2a$10$...` — it arrives mangled (60 chars in,
   32 out) and every password check returns 401 while the file looks correct.
   Vercel does not expand, so production is unaffected and the bug is
   local-only. Verify with:
   ```
   node -e "require('@next/env').loadEnvConfig(process.cwd(),true);console.log(process.env.ADMIN_PASSWORD_HASH.length)"
   ```
   60 is right; 32 means the dollars ate it.
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
