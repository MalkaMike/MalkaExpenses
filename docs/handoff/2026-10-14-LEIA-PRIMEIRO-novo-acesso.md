# START HERE — continuing Malka Finance from a new Claude account (written 2026-10-14, BRT)

Read this first, then `2026-10-14-session-close.md` (every fact there has its command and date), then
`CLAUDE.md` (access recipe). **Memory notes do not travel between Claude accounts. This folder does.**

## What is the state, in five lines
1. GitHub, the live site (`https://malkafinance.vercel.app`), the database and Pluggy were all
   reachable and in sync on 2026-10-14. HEAD of `main` = `847e768`.
2. Bank data comes through **MeuPluggy**. 27 new transactions (10–14 Oct) were pulled in tonight.
3. The Pluggy API **cannot** refresh MeuPluggy (HTTP 400). Only a human clicking **Atualizar** on
   `https://meu.pluggy.ai/connections` can. Login: `mickael@kenlo.com.br`, passwordless email code.
4. **Porto Bank Visa \*146** is not in Meu Pluggy (only the Porto current account is). Last row
   2026-06-18. Mickael is sending PDF invoices. No importer exists.
5. Judge freshness by each Pluggy item's `lastUpdatedAt` and `max(created_at)` on `transactions` —
   never by `status` (the dead Itaú Cartões item still says `UPDATED/SUCCESS`).

## Do first in the new session (a few minutes)
| Check | How | Expect |
|---|---|---|
| Claude can reach Google Secret Manager | `& "$env:USERPROFILE\.claude\kenlo-secrets.ps1" -Check SUPABASE_ACCESS_TOKEN` | present |
| Database read | recipe in `CLAUDE.md`, then `node scripts/db-query.mjs --file x.sql` | rows, not zero |
| Vercel | `vercel whoami` | `mickaelmalka-3164` (else `vercel login`; Mickael approves in the browser) |
| Git | `git fetch origin; git status -sb` | note the branch `docs/2026-10-14-session-close` is NOT merged |
| Pluggy | load `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`, `POST /auth`, `GET /items/{id}` | `lastUpdatedAt` per item |

Scripts used tonight lived in the old session's scratchpad and are gone. Rebuild them from the
handoff: (a) read `external_id` of Pluggy rows from the DB, (b) pull `/accounts?itemId=` and
`/transactions?accountId=&from=` per item, (c) diff. Pass SQL through `--file`, never inline.

## Open work, in order
1. **Porto PDFs.** Mickael puts the invoices (June → current open one) in
   `C:\Users\Mickael.Malka\Downloads` and names them. Read each PDF, dedupe against the 116 existing
   rows, show Mickael the list (count, total, dates) **before** writing, then a numbered migration in
   `db/migrations/` with a snapshot table + rollback SQL. Instalments: charge N of M is billed ~N−1
   months after purchase; amounts stored in centavos. Run the supplier rules and the four-bucket
   labels afterwards.
2. **Check the 27 new rows** against the four buckets (Família / Kenlo+Laik / Saúde / Not-in-Family).
   Confirm the Pix from LAIK MIDIA DIGITAL (R$15.000, 2026-10-10) and the Itaú auto-invest sweep
   (−R$14.472,46 / +R$1.070,74, 2026-10-14) are treated as transfers/not spending.
3. **12 old rows (~R$814)** in Pluggy but not in the app (Jul–Aug). Find out why before adding —
   possible duplicates from re-issued ids.
4. Personal Gmail mailbox for the receipts search is still not connected (since 2026-08-28):
   `/admin` → row "Pessoal" → Connect. Needs Mickael; may need OAuth consent set to External.
5. Optional: add the Meu Pluggy login + "refresh = Atualizar on the site" + "freshness =
   `lastUpdatedAt`" to `CLAUDE.md`.

## Rules that bit tonight
- **Production writes only by numbered migration**, after Mickael approves the exact list.
- **Never type authentication codes, bank passwords or card data for Mickael.** The Meu Pluggy email
  code and any bank approval are his.
- **Say what was checked before saying "no access".** Tonight's first answer ("no access to your
  personal finance") was wrong: the project was in `kenlo\Personal Finance`.
- Never print credential values. The first `vercel login --debug` printed a one-time device code
  (harmless now, but avoid `--debug` on logins).
- `vercel link` overwrote `.env.local`; the older copy is `.env.local.prev` (2026-08-13).
- Vercel is on the Hobby plan: runtime logs reach back only about 30 minutes.
- Chrome extension "Claude in Chrome" was NOT connected tonight; Playwright was. The Playwright
  browser is signed in to Meu Pluggy and also holds unrelated tabs from other sessions — leave them.

## Paste this as the first message in the new session
```
Continue Malka Finance. Read, in order: docs/handoff/2026-10-14-LEIA-PRIMEIRO-novo-acesso.md,
docs/handoff/2026-10-14-session-close.md, then CLAUDE.md. Run the "Do first" checks, tell me what
is red, then start with the Porto Bank PDFs in my Downloads folder. Ask me before any database
write and show me the exact list first.
```
