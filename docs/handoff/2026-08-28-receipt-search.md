# Handoff — Malka Finance receipt search, 2026-08-28

Session closed 2026-08-28 with the app deployed and healthy. **One human action is outstanding**
(connect the personal Gmail). Everything else is done and verified.

Started from the question *"when did I pay IZIPIZI / Blanche?"* and ended up fixing why the nota
fiscal search had found nothing since 17 June.

---

## DECISIONS

| Decision | Why | Owner |
|---|---|---|
| Fix the receipt search rather than answer the one question | The search had been returning silent zeros for two months; answering by hand would have left it broken | Claude, approved by Mickael |
| Reopen 1,080 instalment rows for re-search | A result produced by broken logic was cached as the answer; only clearing `gmail_searched_at` re-asks the question | Mickael, explicit go |
| Drain all 1,080 by hand instead of waiting ~4 nights | Mickael overrode the recommendation to let it drain naturally. **He was right** — it recovered a real nota fiscal that would otherwise have surfaced days later, and it proved the fix works | Mickael |
| Add an optional `receipts` mailbox rather than repoint `admin` | `admin` is also the sender in `lib/gmail/send`; repointing it would silently change the From address on health-outbox and pluggy-sync email | Claude, approved by Mickael |
| Store `source_email` per receipt | With two mailboxes the hardcoded `/mail/u/0/` deep link opens the wrong account and shows "message not found" | Claude |
| Do NOT widen the receipt keyword filter | Admitting "pedido"/"compra" would find more but also more false positives — a product judgement that is Mickael's, and no missed-email example exists yet | Deferred to Mickael |

## FACTS MEASURED (2026-08-28 — facts expire, re-run the query before trusting)

Access recipe for all queries below is in `CLAUDE.md` at the repo root.

**The two purchases originally asked about** — `transactions` where description matches izipizi/blanche:
- IZIPIZI: **two separate purchases, both R$ 499,00.** 09 Jan 2026 as a single charge; and a 2025
  purchase whose final instalment (`04/04`, R$ 124,75) was billed 31 May 2025. Instalments 1–3 are
  before the ledger starts, so the original 2025 purchase date is **not recorded**.
- BLANCHE JARDIM: **R$ 539,00 in 5×R$ 107,80.** First billed 09 Aug 2026; instalments 2–5 dated
  28 Sep / 28 Oct / 28 Nov / 28 Dec 2026 — all **future-dated by Pluggy**. As of 28 Aug 2026 only
  R$ 107,80 had actually been charged; R$ 431,20 still to come.
- Both on the **The One** credit card (`accounts.id = 3e56f075-c0dd-49bd-92aa-afaca0998f26`).

**Scale of the broken search** (query in `db/migrations/0042_reopen_instalment_gmail_search.sql` header):
```
1525  loose regex match (includes dates like "12/05" — NOT the right rule)
1240  true instalment rows by the code's own rule (M>=2, N<=M)
1164  of those already searched
1163  of those found nothing
1080  of those the cron can actually retry   <- the set that was reopened
   1  instalment row already had a receipt   <- left untouched
```
⚠️ An earlier figure of **1,253 was wrong** — loose regex, no `M>=2 / N<=M` guard, and it counted
rows the cron skips (fake/transfer/positive). Corrected to 1,080 before any write.

**After the drain** (`select count(*) ... join gmail_search_reopen_0042`):
```
1080 reopened · 1080 re-searched · 0 still pending · 0 errors
receipts 119 -> 120 · verified-confidence receipts 0 -> 1
```

**The one receipt recovered:** LINHA BLOOM, "DANFE - nº 001197", from `do-not-reply@bling.com.br`,
Gmail message `19c477babf47f0a1`, **sent 10 Feb 2026**. Matched to transaction
`Vindi *SubdvIndEC03/03` dated **10 Apr 2026**, R$ 1.283,34 — instalment 3 of 3, so the purchase was
~2 months before the billing date. Matched inside the attached NF-e XML
(`35260236877951000190550010000011971250527957-nfe.xml`). The old code searched ±7 days around
10 April and looked for "R$ 128.334,00"; it could never have found this.

**Mailbox:** `gmail_credentials` role `admin` = `mickael.malka@i-value.com.br`. Access token was
minted **during** the run (52 min to expiry when checked), so the search genuinely queried Google —
the zeros are real, not a dead connection. Mickael confirmed IZIPIZI and Blanche receipts go to his
**personal Gmail**, which the app has never been connected to.

**Throughput:** ~150–230 rows per cron run (5 runs cleared 1,080 in ~25 min). An earlier "about two
weeks" estimate was wrong by an order of magnitude — it was derived from batch size and time budget,
never measured.

## ASSUMPTIONS NOW FALSE

1. **"The nightly receipt search works, it just finds nothing."** False. It had three independent
   defects, each fatal on its own. Fixed in `d542014`.
2. **"1,253 instalment rows need reopening."** False — 1,080. Superseded by the measurement above.
3. **"Draining will take about two weeks."** False — ~25 minutes.
4. **"The app might be searching a different mailbox than the one we checked by hand."** False. It
   reads the same work account. Resolved by querying `gmail_credentials`.
5. **"A zero result means no receipt exists."** Dangerous. `find-receipt-v2` swallows per-variation
   Gmail errors, so a dead token looks identical to "nothing found". Always confirm the token was
   refreshed before believing a zero.

---

## What shipped

| Commit | What |
|---|---|
| `d542014` | Three receipt-search bugs: centavos-vs-reais, billing-date-vs-purchase-date, instalment-slice-vs-full-price. 7 tests. |
| `c1bd4a6` | Migration `0042` — reopened 1,080 instalment rows (snapshot + rollback included). |
| `19c08f6` | Optional `receipts` second mailbox; migration `0043` adds `source_email`; mailbox-aware Gmail deep links. 3 tests. |

Also carried out: `3f4b10f` (Mickael's own MeuPluggy + logout fix from 20 Aug) had been sitting
unpushed for 8 days and went live with `d542014`.

All three deployments verified `state=success` via the GitHub deployments API. Migrations `0042` and
`0043` are applied to production and were verified by reading the data back.

## OUTSTANDING — the only thing left

**Connect the personal Gmail.** `/admin` → the **"Pessoal"** row → **Conectar**. Requires a human at
the browser (OAuth consent); Claude cannot do it.

- **Likely snag:** if the Google OAuth consent screen is set to **Internal** (restricted to the
  i-value.com.br workspace), a personal `@gmail.com` will be refused at sign-in. Fix is a one-time
  switch to "External" in Google Cloud Console. Unverified — nobody has checked that setting.

**Then, in order:**
1. Hit refresh on the 7 IZIPIZI/Blanche rows (`/admin/inbox`) — no database write, the manual button
   bypasses the cache. This finally answers the original question and live-tests the second mailbox.
2. Only if step 1 finds something: reopen the ~5,876 already-searched rows so history gets searched
   against the personal mailbox too. Model it on `0042` — same shape, ~25 min to drain.

Connecting alone changes nothing for existing transactions: they are all stamped
`gmail_searched_at` and the nightly job skips them.

## Known limits, not bugs

- The search **requires** nota-fiscal words (`nota fiscal`, `nfe`, `invoice`, `receipt`, `recibo`,
  `comprovante`, `fatura`, `boleto`). A plain "Pedido confirmado" order email is filtered out before
  the amount is ever checked. Deliberate; widening it is Mickael's call.
- In-store card purchases generate no email at all. A large share of the ledger is unfindable in
  principle, which is the honest explanation for a 1-in-1,080 hit rate.
- `parseBRL("R$ 107,80")` returns `null` — the regex strips the `R` and leaves the `$`. **Not a
  production bug**: `findAllAmounts` strips the prefix before calling it. It will bite whoever calls
  `parseBRL` directly. Left alone deliberately.
