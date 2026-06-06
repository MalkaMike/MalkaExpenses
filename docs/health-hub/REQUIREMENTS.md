# Health Hub — Requirements brief (ground truth for planning)

> This is the authoritative brief. The 5 Codex planning rounds refine against it.
> Confirmed by Mickael 2026-06-06. Do not invent requirements; mark assumptions.

## Vision
A **shared Health hub** inside the Family Expenses app that assembles and tracks
**medical reimbursement claims** end-to-end. A claim is reimbursable only when
**three parts are together**:

1. **💰 Bank expense (payment proof)** — comes automatically from the Pluggy bank
   integration (already built: transactions + installment-aware payment matcher).
2. **📄 NF / recibo (fiscal document, WITH its service description)** — arrives via:
   - automatic weekly import from the São Paulo NFS-e portal (built), OR
   - bulk PDF drop (many at once "in lot"), one-by-one, or weekly batches.
   All ingestion paths must be supported. The NF's **service description is
   mandatory**.
3. **🩺 Prescription / pedido médico** — the doctor's document. **Mandatory.**
   Obtained manually OR automatically via scan (mobile camera) / upload / download.

When all three are assembled → the app **auto-emails the claim to the secretary
(Celina)** → she confirms receipt + confirms she sent it to the insurer →
Mickael confirms the **money received** in a France account (EUR).

## Confirmed decisions (2026-06-06)
- **"Description" mandatory = BOTH**: the NF service description AND a doctor's
  prescription must be present for a claim to be reimbursable/complete.
- **Access / roles**:
  - **Mickael** — full admin (everything, as today).
  - **Ayelet (wife)** — Health hub (same features as Mickael there) + her current
    spending portal. NO access to finance/admin tools.
  - **Celina (secretary)** — **Health hub ONLY**, restricted: confirm received +
    confirm sent. Cannot see/edit finances; tightly LGPD-scoped; access logged.
  - **public** — login required.
- **Email send** = **auto-send via Mickael's connected Gmail** when a claim is
  complete (requires adding Gmail "send" OAuth scope). Email attaches NF +
  prescription + a summary sheet, to Celina's address (Mickael will provide).
- **Money tracking** = on receipt, record **amount in EUR + date + which France
  account**, and compare against the claimed amount (to catch partials).

## Claim lifecycle (state machine to design)
assembling → ready (3 parts complete) → emailed_to_secretary (auto Gmail) →
secretary_received (Celina confirms) → secretary_sent (Celina confirms submitted
to insurer) → money_received (Mickael confirms: EUR amount + date + account).
Plus branches: rejected, partial (received < claimed), re-send. The app does NOT
submit to the insurer directly — Celina does that outside; the app orchestrates
+ tracks.

## Suggested additions (Mickael asked to include)
- **Claim deadline tracking** — insurers reject late claims (filing window, often
  N months from service date). Flag claims nearing expiry.
- **Per-family-member grouping** — claims by patient (Mickael, Ayelet, Lavi, Lya,
  Mila). Reimbursement is per person.
- **Partial / rejected handling** — track claimed vs received; allow re-send.
- **Full audit trail + notifications** — every state change logged (who+when);
  notify the right person at each step.
- **Bulk PDF drop** — drag-drop many NFs; auto-dedup + auto-categorize.
- **EUR vs BRL** — paid in BRL, reimbursed in EUR; track both.
- **LGPD / privacy** — medical data; lock Celina's scope; encrypt/limit access; log.

## Existing system (what's already built — reuse, don't rebuild)
- **Stack**: Next.js 15 (App Router) + Supabase (Postgres) + Pluggy (Open Finance)
  + Gemini 2.5 on Vertex AI (gcloud ADC locally; `@google/genai`). Deploy: Vercel.
- **Auth**: signed-cookie roles — `pf_admin` (admin) / `pf_household` (Ayelet, portal)
  via `lib/auth/admin.ts` `getRole()` → admin | household | public. HMAC signed,
  sliding timeout. NO per-user accounts yet (shared passwords). Secretary role is NEW.
- **Data** (migrations to 0018): `transactions`, `nota_fiscais` (+ payments,
  flights, items), `insurance_policies` + `policy_dependents` +
  `policy_coverage_rules`, `medical_documents` (prescriptions), `reimbursement_claims`
  (NF + prescription + policy + eligibility).
- **Built**: NF extraction (PDF folder + SP portal + Gmail), installment-aware
  payment matcher (`scripts/match_payments.py`), weekly auto-refresh (Task
  Scheduler), document scan engine (`lib/ai/scan.ts`), policy-brain backend
  (`lib/ai/policy.ts`), Health hub v1 (`/admin/health` — 3-part readiness),
  per-claim prescription scan/attach.
- **Gaps**: scanned files stored to local `private/` (won't persist on Vercel →
  need Supabase Storage). Eligibility engine pending the policy document. No
  secretary role / multi-user accounts. No email send. No money-received tracking.
  No deadline/notification/bulk-drop.

## Constraints & non-goals
- **Deploy = Vercel** (serverless, ephemeral FS) → document storage MUST move to
  Supabase Storage (signed URLs) before prod.
- **LGPD**: medical + financial data; secretary access tightly scoped + audited.
- **Honesty/verifiability**: AI extractions keep source evidence; no invented data.
- **Non-goals**: we do NOT submit claims to the insurer (Celina does, outside).
  The policy eligibility engine (reimbursable? within limit?) is a separate track,
  blocked on the policy document — plan for it but it's not on the critical path.

## What the plan must deliver
A phased roadmap (milestones, dependencies, sequencing, effort sizing) covering:
auth/roles redesign (incl. secretary + per-user accounts), full data model for the
claim lifecycle + money + deadlines + audit, all NF ingestion paths incl. bulk drop,
prescription capture, the assemble→email→confirm→received flow, Celina's restricted
UI, Gmail send integration, Supabase Storage migration, notifications, LGPD controls,
and the deploy. Plus open risks + decisions still needed.
