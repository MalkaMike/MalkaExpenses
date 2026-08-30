# Malka Finance — Claude context

**Project name: Malka Finance** (folder is `Personal Finance`, npm package `personal-finance`,
Vercel project `malkafinance`, GitHub `MalkaMike/MalkaExpenses`). If someone says "Malka Finance",
"malkafinance", "Casa", or "the personal finance app" — this is it.

Private household finance app with two books: a **real ledger** (admin only) and a **shared ledger**
the household sees. Bank data arrives via Open Finance (Pluggy), through the personal aggregator
connection **MeuPluggy** (connector 200). Full description in `README.md`; architecture in
`docs/architecture.md`; domain words in `docs/GLOSSARY.md`.

Live: **https://malkafinance.vercel.app** · Push to `main` → Vercel auto-deploys.

---

## How to reach the database (this took a whole session to work out — do not rediscover it)

The tooling scripts do **not** find their credentials on their own. `SUPABASE_ACCESS_TOKEN` lives in
**Google Secret Manager** (project `ai-first-mm`); `SUPABASE_PROJECT_REF` is not a secret and lives
in `~/.claude/kenlo-config.conf`. The repo scripts still point at the local secrets file that was
retired on 2026-08-28, so they fail with "Missing SUPABASE_ACCESS_TOKEN" until you load it yourself.

Working recipe (PowerShell — the default shell on this machine):

```powershell
& "$env:USERPROFILE\.claude\kenlo-secrets.ps1" -Load SUPABASE_ACCESS_TOKEN | Out-Null
foreach ($line in (Get-Content "$env:USERPROFILE\.claude\kenlo-config.conf")) {
  if ($line -match '^\s*SUPABASE_PROJECT_REF\s*=\s*(.+)$') { $env:SUPABASE_PROJECT_REF = $matches[1].Trim().Trim('"').Trim("'") }
}
node scripts/db-query.mjs --file query.sql      # READ ONLY - refuses anything but SELECT/WITH
node scripts/run-migration.mjs 00NN_name.sql    # WRITES - from db/migrations/ only
```

- **Pass SQL via `--file`, never as an inline argument.** A `$` end-of-string anchor inside a
  double-quoted PowerShell string gets mangled and the query silently returns **0 rows**. That
  produced a confident, wrong "zero" once already. **An unexpected zero is a broken tool until
  proven otherwise.**
- `CRON_SECRET` is also in Secret Manager — it authenticates the cron endpoints
  (`Authorization: Bearer <secret>`), which is how you trigger a search run by hand instead of
  waiting for 06:30 UTC.
- Never print a credential value. `kenlo-secrets.ps1` loads it into the session only.

## Facts that bite

- **Money is stored in CENTAVOS** (`real_amount = -10780` is R$ 107,80). `fromDb()` in `lib/money.ts`
  converts. Passing the raw column into anything expecting reais is a real bug that shipped and
  survived two months — see `docs/handoff/2026-08-28-receipt-search.md`.
- **Instalments:** Pluggy writes `(N/M)` into `description_clean`; PDF imports leave a trailing
  `NN/MM` in `description_raw`. Instalment N is billed roughly N-1 months AFTER the purchase, and
  Pluggy books future instalments with **future dates**. Parse with `installmentInfoFrom()` in
  `lib/gmail/find-receipt-v2.ts`.
- **A receipt for an instalment purchase quotes the FULL price**, not the monthly slice.
- **The nightly receipt search runs once a day at 06:30 UTC** (`vercel.json`), 250s budget. It
  processes ~150–230 rows per run. It selects on `gmail_searched_at IS NULL` — so **a row searched
  under broken logic stays cached forever as "nothing found"**. Clearing that stamp is the only way
  to re-ask. This is the single most important trap in this codebase.
- **Gmail roles:** `gmail_credentials` holds one row per `user_role`. `admin` = work account **and
  the sender for `lib/gmail/send`** — never repoint it to fix search coverage, that would silently
  change the From address on outbound email. `health` = Ayelet. `receipts` = optional second
  read-only mailbox for the receipt search (added 2026-08-28).
- **The middleware 404s every `/api/` route without a session** — a 404 from outside proves nothing
  about whether a route exists or works.
- `lib/gmail/search.ts` is the old v1 search and is **imported by nothing**. Dead code.

## House rules for this repo

- Production data is read-only by default. Writes go through a **numbered migration** in
  `db/migrations/`, and any migration that changes existing rows carries a snapshot table plus
  rollback SQL at the bottom.
- Before deploy: secret-scan the diff, `npm run typecheck`, `npx vitest run`, `npm run build`.
- After deploy: confirm the live revision. The GitHub deployments API works unauthenticated here —
  `https://api.github.com/repos/MalkaMike/MalkaExpenses/deployments` → check `state=success`.
  **Never say "deployed" without reading that back.**
