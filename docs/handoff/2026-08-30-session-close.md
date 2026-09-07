# Session close — Malka Finance, 2026-08-30

Formal close record. Companion to `2026-08-28-receipt-search.md`, which carries the narrative.
Session ended because Mickael is switching to another Claude account on the same computer.

---

## 1. DECISIONS

| # | Decision | Why | Owner |
|---|---|---|---|
| 1 | Fix the nota fiscal search instead of just answering "when did I pay IZIPIZI" | The search had returned silent zeros since 2026-06-17; answering by hand would have left it broken | Claude, approved by Mickael 2026-08-30 |
| 2 | Fix at the root (shared function) rather than per-caller | The admin button was already correct and the cron was not — patching the cron alone would have let the two drift again | Claude |
| 3 | Reopen 1,080 instalment rows rather than accept the stored zeros | The cron selects `gmail_searched_at IS NULL`; a zero written by broken logic is cached permanently | Mickael, explicit authorisation 2026-08-30 |
| 4 | Drain all 1,080 by hand rather than let it run over ~4 nights | Mickael overrode my recommendation to stop. **He was right** — see ASSUMPTIONS #3 | Mickael |
| 5 | Add an optional `receipts` mailbox rather than re-point `admin` | `admin` is also the sender in `lib/gmail/send`; re-pointing it would silently change the From address on outbound mail | Claude, approved by Mickael |
| 6 | Store `source_email` per receipt (migration 0043) | With two mailboxes the hardcoded `/mail/u/0/` deep link opens the wrong account | Claude |
| 7 | Do **not** widen the receipt keyword filter | Admitting "pedido"/"compra" finds more but also more false positives — a product judgement, and no missed-email example exists yet | Deferred to Mickael, still open |
| 8 | Do **not** delete `lib/gmail/search.ts` (dead v1 module, imported by nothing) | Out of scope; deletion is its own decision | Deferred to Mickael, still open |
| 9 | Create `CLAUDE.md` at the repo root | The DB access recipe cost a full session to derive and is not discoverable from the repo; a new session in this folder started blind | Claude |

## 2. FACTS MEASURED

All measured **2026-08-30** unless stated. Access recipe: `CLAUDE.md` at the repo root.
**Facts expire — re-run the query before trusting any number here.**

**Real bank data in the ledger** — supersedes the README's "sandbox" claim:
```sql
select count(*), min(date), max(date), count(distinct account_id)
from transactions where source = 'pluggy'
```
→ **6,337 rows · 9 accounts · 2025-06-03 → 2027-06-28** (of 7,706 rows total).
Future dates are instalments Pluggy books in advance.

**The reopen set** — full CTE in the header of `db/migrations/0042_reopen_instalment_gmail_search.sql`:
```
1525  loose regex match (WRONG rule — counts dates like "12/05")
1240  true instalment rows by the code's own rule (M>=2, N<=M)
1164  already searched · 1163 of those found nothing
1080  reopened (further restricted to rows the cron can retry)
   1  instalment row already had a receipt — left untouched
```

**After the drain** (join against `gmail_search_reopen_0042`):
```
1080 reopened · 1080 re-searched · 0 pending · 0 errors
receipts 119 → 120 · verified-confidence receipts 0 → 1
```

**The single receipt recovered:** LINHA BLOOM, "DANFE - nº 001197", `do-not-reply@bling.com.br`,
Gmail message `19c477babf47f0a1`, sent **2026-02-10**. Matched to `Vindi *SubdvIndEC03/03` dated
**2026-04-10**, R$ 1.283,34 (instalment 3 of 3). Value confirmed inside the attached NF-e XML.

**Throughput:** 5 triggered runs cleared 1,080 rows in ~25 minutes (~150–230 rows per run).

**Mailbox:** `select google_email, access_token_expiry from gmail_credentials` → role `admin` is
`mickael.malka@i-value.com.br`. Token was refreshed *during* the run, proving Gmail was genuinely
queried and the zeros are real.

**Shipped and verified live:** commits `d542014`, `c1bd4a6`, `19c08f6`, `513b9f7` on `main`.
Deployments confirmed `state=success` via
`https://api.github.com/repos/MalkaMike/MalkaExpenses/deployments`. Migrations `0042` and `0043`
applied to production and read back.

## 3. ASSUMPTIONS NOW FALSE

1. **"The nightly receipt search works, it just finds nothing."**
   False — three independent defects, each fatal alone. Superseded by `d542014` and by
   `docs/handoff/2026-08-28-receipt-search.md`. New memory:
   `zero-cacheado-e-resposta-que-nunca-foi-perguntada.md`.

2. **"1,253 instalment rows need reopening."** — *my own figure, wrong.*
   Actual: **1,080**. The first count used a loose pattern with no `M>=2 / N<=M` guard and counted
   rows the cron skips. Corrected before any write; recorded in the `0042` migration header.

3. **"Draining will take about two weeks."** — *my own estimate, wrong by ~20×.*
   Actual: **~25 minutes**. Derived from batch size instead of measured. This estimate is why I
   recommended stopping; acting on it would have missed the LINHA BLOOM nota fiscal. New memory:
   `ele-mandou-drenar-e-estava-certo.md`.

4. **"The app may be reading a different mailbox than the one we checked by hand."**
   False — same account. Resolved by querying `gmail_credentials`.

5. **"Open Finance is live in sandbox; real banks need Pluggy production approval."**
   False and stale. **Superseded in place** in `README.md` on 2026-08-30 with the measurement above
   and a dated ⚠️ marker. Real banks are read via MeuPluggy (connector 200).

6. **"A zero result means no receipt exists."**
   Dangerous. `find-receipt-v2` swallows per-variation Gmail errors, so a dead token is
   indistinguishable from "nothing found". Always confirm the token refreshed first.

---

## Still open

1. **Connect the personal Gmail** — `/admin` → "Pessoal" → Conectar. Needs a human at the browser.
   Likely snag: an **Internal** OAuth consent screen refuses `@gmail.com`; fix is a one-time switch
   to External in Google Cloud Console. **Unverified.**
2. Then refresh the 7 IZIPIZI/Blanche rows (no DB write) — answers the original question.
3. Only if (2) finds something: reopen the ~5,876 already-searched rows, modelled on `0042`.
4. Open judgement calls: the keyword filter (decision 7) and the dead v1 module (decision 8).
