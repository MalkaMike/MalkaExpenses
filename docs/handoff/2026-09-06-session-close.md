# Session close — Malka Finance, 2026-09-06

The day the ledger got sorted. Started as "is the bank connection working?", ended with every
one of 584 suppliers classified and the labels made permanent.

---

## 1. DECISIONS

| # | Decision | Why | Owner |
|---|---|---|---|
| 1 | A supplier label must apply to FUTURE charges, not just existing ones | Tagging only ever reached rows already in the ledger; the next charge from the same supplier arrived untagged, forever | Mickael, 2026-09-06 |
| 2 | One supplier belongs to exactly ONE category | Manus AI was tagged Kenlo *and* Saúde — the same R$11.113,18 counted twice | Mickael, 2026-09-06 |
| 3 | New bucket **Not-in-Family** (slug `not_family`) = things that should not count in the family budget | Started as "Gastos Idiotas" for a mobile game; renamed once it also held an insurance premium, because the label should name the rule, not the mood | Mickael, 2026-09-06 |
| 4 | APRIL (health insurance premium) → Not-in-Family. Not Family, not Kenlo, not Saúde. Its credits go there too | A premium is not a claimable expense; and the refund must sit beside the charge that produced it | Mickael, 2026-09-06 |
| 5 | Manus AI → Kenlo only | It is an AI tool; the Saúde tag was a slip | Mickael, 2026-09-06 |
| 6 | Health-plan payouts → labelled `health_reimb`, but STAY inside Family | It is household money; the label is for visibility, not for moving it | Mickael, 2026-09-06 |
| 7 | Interest and penalties → labelled `late_fees`, STAY inside Family | Real household spending, but was invisible inside "Financeiro" | Mickael, 2026-09-06 |
| 8 | Stay in Family: pharmacies (≈R$20,5k), Óticas Wanny, ONC Point, Brazil Vitamins, DAMA EINSTEIN | Mickael's own policy; DAMA EINSTEIN is a restaurant inside the hospital, not care | Mickael, 2026-09-06 |
| 9 | Hotels **in Campinas** → Kenlo/Laik. Every other hotel and all flights → Family | Campinas trips are work | Mickael, 2026-09-06 |
| 10 | Money sent to Laik Mídia Digital (R$67,8k) and Akiva (R$32k) → business buckets, never Family | It is money to his own companies, not household spending | Mickael, 2026-09-06 |
| 11 | Kenlo = dev/infra/AI stack + work travel. Laik = ads, media, design, marketing tooling | Follows the split already present in the ledger before today | Claude, ratified by Mickael 2026-09-06 |

---

## 2. FACTS MEASURED (2026-09-06 — all re-runnable)

**Pluggy: the account has exactly ONE connector.**
`GET https://api.pluggy.ai/connectors?pageSize=200` → `total: 1` — MeuPluggy, id 200,
`type: PERSONAL_BANK`, `isOpenFinance: false`. This is *why* the Porto Bank credit card cannot be
connected: the plan has no regulated Open Finance connector, only Pluggy's own personal aggregator.
Independently corroborated by the README written on 2026-08-30 ("expired trial workspace… can no
longer refresh direct bank items").

**All four bank connections healthy.** `GET /items/{id}` × 4 → every one `status: UPDATED`,
`executionStatus: SUCCESS`, 0 failed logins, no errors.

**Final buckets, 2026-01-01 → 2026-09-04** (`scratchpad/net_table.sql`):

| Bucket | Spent | Came back | Net |
|---|---|---|---|
| Família | R$ 755.004,69 | R$ 18.344,38 | R$ 736.660,31 |
| Kenlo + Laik | R$ 208.978,45 | R$ 990,21 | R$ 207.988,24 |
| Saúde | R$ 77.377,85 | R$ 0,45 | R$ 77.377,40 |
| Not-in-Family | R$ 20.896,24 | R$ 15.394,13 | R$ 5.502,11 |

Family began the session at **R$1.128.493,24** and ended at **R$755.004,69**. Nothing was deleted —
R$373k was moved to the bucket it belonged in.

**Late fees: R$21.169,99 since January, accelerating.** Mar R$6,67 · Apr R$1.056,39 · May R$828,84 ·
Jun R$1.541,40 · **Jul R$9.259,43** · Aug R$2.258,42 · **Sep R$6.218,84 in four days**.
Query: `latefee_month.sql`. This is the most actionable number found all day.

**The overdue rollover is not spending.** Three same-day, same-amount, same-account pairs on the
Nubank card: 19/06 ±8.673,34 · 19/07 ±18.286,88 · 19/08 ±19.821,35 = **R$46.781,57** each way.
The bank rolling an unpaid balance. Now marked as transfers.

**Rule coverage proven, not assumed.** For every labelled supplier, does a rule exist that catches
its NEXT charge? First run: 7 failures. After fixing: **263 of 263**, and **zero** transactions in
the ledger match a rule while remaining unlabelled. Query: `scratchpad/coverage.sql` +
`final_check.sql`.

**Sync verified live on 2026-09-06 21:47 BRT** — `GET /api/cron/pluggy-sync` with CRON_SECRET →
`items: 4, inserted: 4, errors: [], daysStale: 0`.

**April, gross vs net:** R$25.258,55 charged (12 instalments, some future-dated), R$15.394,13
credited back (`CREDITO APRIL` R$14.877,03 on 09/06 + `IOF de volta` R$517,10 on 13/08).

**Porto Bank Visa \*146 — coverage hole, unchanged.** `pluggy_item_id IS NULL`; no data after
2026-06-18. Mickael will supply PDF invoices.

### The four false positives that would have mislabelled money forever

These are the reason every pattern in `db/migrations/0049`–`0055` is narrow:

1. **`BancadoBento` contains the letters a-d-o-b-e** — "Banc**adoBe**nto". A plain `ADOBE` rule
   tagged an unrelated merchant as a Kenlo expense. Fixed with `*ADOBE` (contains) + `ADOBE` (exact).
2. **`Zara Mamila` contains "amil"** — matched a search for the health insurer Amil.
3. **`DAMA EINSTEIN` is a restaurant inside the hospital** — an `EINSTEIN` rule would send it to
   Saúde. Rules use unit names: `EINSTEIN MORUMBI`, `EINSTEIN IBI`, `ALBERTEINSTEIN`.
4. **`Pagamento de boleto` spans 22 different suppliers** (school tuition, condo…). It was created
   by the first backfill because the only boletos tagged so far happened to be health ones. Deleted;
   the guard that now prevents this is `countOtherSuppliersMatchingPattern()`.

Also caught: `GITHUB  INC.` has **two** spaces in the statement, the rule had one — it never matched.
`RegistroBR` has no dot. Laik and Akiva move money **both ways** (Akiva sent R$1,2 mi back), so every
rule is restricted to money going out where sign matters.

---

## 3. ASSUMPTIONS NOW FALSE

| Was believed | Truth (2026-09-06) | Supersedes |
|---|---|---|
| "The R$1.163.833,05 excluded as transfers is credit-card bill payments, already counted as card purchases" — **stated by Claude in chat and published in the first dashboard** | **False.** Actual card bill payments = **R$3.805,62**. The R$1,16 mi is mostly transfers between Mickael's own accounts plus income-flagged credits. Retracted and the artifact republished | The first version of artifact `799d53bc`, published earlier on 2026-09-06 |
| Tagging a supplier makes the label stick | **Was false until today.** Tagging only bulk-applied to rows that already existed | Behaviour before migration `0044` |
| Family spending Jan–Sep = R$1.128.493,24 | **R$755.004,69.** R$373k belonged to other buckets | The first dashboard, same artifact URL |
| Business spending was ~R$31k | **R$208.978,45** — 6,7× more. It was almost entirely invisible | Same |
| `insurance` (Plano) is the right tag for anything health-related | It marks an expense **to be claimed back**. A premium (April) and a payout (`health_reimb`) are different things and now have their own homes | — |

---

## 4. WHAT SHIPPED

Migrations `0044`–`0056` (13), all applied to production and verified after each one.
Code: `lib/merchants/rule-pattern.ts` (pure, tested), `lib/merchants/merchant-rules.ts`,
`lib/pluggy/sync.ts` (applies tag rules on every sync), the tag route, the transaction PATCH route.
197 tests pass, typecheck clean.

Commits on `main`, pushed and confirmed on GitHub: `589c8b2`, `82ceb8a`, `f060d78`.

Dashboard: `https://claude.ai/code/artifact/799d53bc-a3f9-43aa-b71d-c4ee10922b6b` (republished,
same URL — the wrong first version no longer exists).

---

## 5. OPEN

1. ~~Vercel deploy not confirmed.~~ **CLOSED 2026-09-06.** All three deploys report
   `state: success` — `589c8b2`, `82ceb8a`, `f060d78`. The code is live, so tomorrow's 06:00 UTC
   sync will label new charges on arrival.
   *Process note worth keeping:* Claude told Mickael twice that this "could not be verified from
   here" — while the answer was written in this repo's own `CLAUDE.md`, under House rules:
   `https://api.github.com/repos/MalkaMike/MalkaExpenses/deployments` works unauthenticated.
   **Read the repo's house rules before declaring something unverifiable.**
2. **Porto Bank Visa** — PDF invoices to come from Mickael; manual entry path decided but not built.
3. **Late fees are still growing** (R$6.218 in the first four days of September). Nothing has been
   done about the cause, only the measurement.
4. **`ANUIDADE DIFERENCIADA` (≈R$5.533)** left as plain Family — it is the card's annual fee, not a
   late charge. Group it if that ever becomes useful.
