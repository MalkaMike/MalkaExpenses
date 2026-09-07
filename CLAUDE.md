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

## The four buckets and three labels (2026-09-06)

Every expense lands in exactly one **bucket**. Buckets are `reimbursement_tags` rows and the order
below is the priority — first match wins:

| Bucket | Tag slug | Meaning |
|---|---|---|
| Not-in-Family | `not_family` | Should not count in the family budget at all (mobile game, April insurance premium) |
| Saúde | `insurance` | An expense **to be claimed back** from the health plan |
| Kenlo + Laik | `kenlo`, `laik` | Work. Kenlo = dev/infra/AI stack + work travel; Laik = ads, media, design, marketing. Both are hidden from the shared household ledger (`shared_amount = 0`) |
| Família | *(no tag)* | The default — everything else |

**Labels** are also `reimbursement_tags` but do NOT move money out of a bucket; they only group it:
`health_reimb` (money the plan paid back — stays in Família), `late_fees` (interest, multas,
encargos — stays in Família), `suspeito`. A tag is a label purely by being absent from the bucket
CASE in reporting queries — there is no flag for it, so **check the query, not the tag table**.

**How a label sticks.** `merchant_rules.reimbursement_tag_id` (migration `0044`) holds a tag next to
the category. Tagging a merchant writes the rule (`app/api/admin/merchants/[key]/tag`), and
`categorizeFresh()` in `lib/pluggy/sync.ts` applies it to every newly-synced row — independently of
the category cascade, so a tag-only rule never stops a row reaching the categorizer.

**Rules match with `contains` on `description_raw`, so a pattern is a trap unless it is narrow.**
Real false positives found in this ledger on 2026-09-06:

- `ADOBE` matches inside **Banc-adoBe-nto**. Adobe uses `*ADOBE` (contains) + `ADOBE` (exact).
- `amil` matches inside **Zara M-amil-a**.
- `EINSTEIN` matches **DAMA EINSTEIN**, a restaurant inside the hospital that is *not* health.
  Rules use unit names: `EINSTEIN MORUMBI`, `EINSTEIN IBI`, `ALBERTEINSTEIN`.
- `Pagamento de boleto` reaches **22 different suppliers**. Never a rule.
- `GITHUB  INC.` has **two** spaces in the statement. `RegistroBR` has no dot.

`countOtherSuppliersMatchingPattern()` in `lib/merchants/merchant-rules.ts` now refuses to write a
rule whose pattern also reaches another supplier. It fails **closed** — a check that cannot run
skips the rule rather than writing a risky one.

**Laik and Akiva move money in BOTH directions** (Akiva sent R$1,2 mi back). Any rule where sign
matters must say `real_amount < 0`.

**"Saldo em atraso" / "Crédito de atraso" on the Nubank card are the same amount, same day, and
cancel out** — the bank rolling an unpaid balance. Not spending. Marked `is_transfer`.

Full record, with every number and the query that produced it:
`docs/handoff/2026-09-06-session-close.md`.

## House rules for this repo

- Production data is read-only by default. Writes go through a **numbered migration** in
  `db/migrations/`, and any migration that changes existing rows carries a snapshot table plus
  rollback SQL at the bottom.
- Before deploy: secret-scan the diff, `npm run typecheck`, `npx vitest run`, `npm run build`.
- After deploy: confirm the live revision. The GitHub deployments API works unauthenticated here —
  `https://api.github.com/repos/MalkaMike/MalkaExpenses/deployments` → check `state=success`.
  **Never say "deployed" without reading that back.**
