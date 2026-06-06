# Health Hub Round 4: Adversarial Stress Test and Risk Register

This register is intentionally adversarial. It assumes the Health Hub plan includes a Next.js 15 app, Supabase database and Storage, a separate `hh_session` portal session, magic-link access, Celina as secretary, Gmail-based outbound mail, Vertex/Gemini extraction, Vercel deployment, and migration/backfill work including `patient_name -> patient_id` and `claim_state`.

Where rounds 1-3 do not explicitly define a control, treat the missing control as a risk until verified. `plan_change: YES` means the prior architecture, data model, API contract, or user flow should change before implementation.

## Summary Table

| # | Category | Severity | Risk title | Plan change? |
|---:|---|---|---|---|
| 1 | Security | HIGH | Portal auth bypass through weak claim/document scoping | YES |
| 2 | Security | HIGH | Celina privilege escalation to finances or other patients | YES |
| 3 | Security | HIGH | Signed URL leakage and replay for documents or receipts | YES |
| 4 | Security | HIGH | Magic-link interception, forwarding, or double use | YES |
| 5 | Security | MED | Session fixation across magic-link and existing app auth | YES |
| 6 | Security | HIGH | IDOR by enumerating claim, document, or receipt IDs | YES |
| 7 | Security | HIGH | CSRF on Next.js server actions that mutate Health Hub state | YES |
| 8 | Security | HIGH | Admin cookie and `hh_session` cookie confusion or collision | YES |
| 9 | Security | MED | Service-role key accidentally reachable from client/runtime logs | NO |
| 10 | Security | MED | Overbroad Supabase RLS bypass for server-side convenience APIs | YES |
| 11 | LGPD / Privacy | HIGH | Medical data overexposed in emails to Celina and email logs | YES |
| 12 | LGPD / Privacy | HIGH | Missing retention, erasure, and purge policy across tables and buckets | YES |
| 13 | LGPD / Privacy | HIGH | Lawful basis unclear per data category | YES |
| 14 | LGPD / Privacy | HIGH | Incomplete who-saw-what audit trail | YES |
| 15 | LGPD / Privacy | HIGH | Diagnosis text stored as ordinary claim metadata | YES |
| 16 | LGPD / Privacy | HIGH | Cross-border transfer to Google Vertex/Gemini lacks LGPD transfer basis | YES |
| 17 | LGPD / Privacy | MED | Prompt and model-output logs retain sensitive medical data | YES |
| 18 | LGPD / Privacy | MED | Support/debug access exposes patient medical data without break-glass controls | YES |
| 19 | Failure Modes | HIGH | Gmail send failure or double-send breaks claim submission | YES |
| 20 | Failure Modes | HIGH | Scan misrecognition changes amount, provider, or patient | YES |
| 21 | Failure Modes | HIGH | Dedup false-merge or false-split corrupts reimbursement state | YES |
| 22 | Failure Modes | HIGH | NF mapped to the wrong family member | YES |
| 23 | Failure Modes | HIGH | Deadline miscalculation by timezone, business-day, or insurer rule | YES |
| 24 | Failure Modes | HIGH | Partial-payment reconciliation marks claims incorrectly | YES |
| 25 | Failure Modes | MED | BRL/EUR exchange-rate source, snapshot, or rounding error | YES |
| 26 | Failure Modes | HIGH | Supabase Storage migration loses medical documents | YES |
| 27 | Failure Modes | HIGH | Gemini extraction hallucination treated as authoritative | YES |
| 28 | Failure Modes | MED | Import retry creates duplicate claims, documents, or emails | YES |
| 29 | Vercel Deploy | HIGH | Serverless timeout during cold start plus OCR/Gemini latency | YES |
| 30 | Vercel Deploy | MED | No persistent filesystem on Vercel for uploaded PDFs/images | NO |
| 31 | Vercel Deploy | HIGH | Production Storage bucket and RLS wiring differs from development | YES |
| 32 | Vercel Deploy | HIGH | Secret handling for Gmail OAuth, Supabase service role, Vertex SA key | NO |
| 33 | Vercel Deploy | HIGH | Unsafe migration ordering and backfills | YES |
| 34 | Vercel Deploy | HIGH | No rollback plan for broken production migration | YES |
| 35 | Vercel Deploy | MED | Existing local Task Scheduler job conflicts with cloud cron replacement | YES |
| 36 | Edge Cases | HIGH | One payment reimburses multiple NFs | YES |
| 37 | Edge Cases | HIGH | One NF maps to multiple claims | YES |
| 38 | Edge Cases | MED | Receipt without CNPJ cannot be identified or deduped | YES |
| 39 | Edge Cases | MED | One prescription covers multiple NFs across dates | YES |
| 40 | Edge Cases | MED | Claim is already past deadline at import time | YES |
| 41 | Edge Cases | HIGH | Insurer pays partial amount or installments across transfers | YES |
| 42 | Edge Cases | HIGH | Re-sending after rejection: new submission vs amendment | YES |
| 43 | Edge Cases | HIGH | Ayelet is both secretary/app user and patient | YES |

## Security

### 1. Portal auth bypass through weak claim/document scoping

- **severity:** HIGH
- **description:** A magic-link or `hh_session` portal may authenticate a person but not bind every query to the exact allowed household, patient, claim, document, and receipt scope. If APIs accept IDs from the client and only check that a portal session exists, a user could reach unrelated medical or financial records.
- **mitigation:** Make authorization object-scoped, not session-only. Every server action, route handler, Supabase query, and signed-URL issuance must join through an explicit access grant such as `health_hub_access_grants(actor_id, patient_id, household_id, role, expires_at)`. Add negative tests for cross-patient and cross-household access.
- **plan_change:** YES - add explicit access-grant scoping to the data model and require it in all Health Hub flows.

### 2. Celina privilege escalation to finances or other patients

- **severity:** HIGH
- **description:** Celina needs operational access to claim documents, but that does not imply access to household finances, all patients, admin screens, exchange-rate settings, reimbursements outside her mandate, or unrelated patient records. A broad role such as `secretary` can easily become equivalent to household admin.
- **mitigation:** Define least-privilege permissions as capabilities, not a single role. Suggested capabilities: `view_claim_packet`, `submit_claim`, `upload_receipt`, `comment_on_claim`, `view_submission_status`; explicitly exclude `view_bank_accounts`, `view_family_finances`, `view_unassigned_patients`, and `manage_users`. Enforce on server and in RLS.
- **plan_change:** YES - replace broad secretary access with patient/claim-scoped capability grants.

### 3. Signed URL leakage and replay for documents or receipts

- **severity:** HIGH
- **description:** Supabase signed URLs for medical documents and receipts can leak through browser history, referrers, email forwarding, logs, screenshots, or Celina forwarding the link. If URLs are long-lived or reusable, anyone holding the URL can replay access.
- **mitigation:** Use short TTLs, single-purpose URLs, no public buckets, no signed URLs in email bodies unless unavoidable, `Referrer-Policy: no-referrer`, and route downloads through an authenticated proxy that records access before issuing a short-lived Storage URL. Rotate paths or revoke tokens when access is removed.
- **plan_change:** YES - change document access flow from static emailed links to authenticated, audited, short-lived download mediation.

### 4. Magic-link interception, forwarding, or double use

- **severity:** HIGH
- **description:** Magic links can be intercepted from email, forwarded to another person, opened by mail scanners, or reused after first login. If the token grants direct session creation without single-use enforcement, a forwarded or replayed link can expose medical documents.
- **mitigation:** Store hashed magic-link tokens with `used_at`, `expires_at`, `created_ip`, and intended actor. Require single use, short expiry, POST confirmation after GET token validation, and token invalidation on successful exchange. Consider device/IP anomaly warnings and re-auth for sensitive downloads.
- **plan_change:** YES - add magic-link token table/state machine and a two-step exchange flow.

### 5. Session fixation across magic-link and existing app auth

- **severity:** MED
- **description:** If the portal accepts an existing `hh_session` cookie before validating a new magic link, an attacker could pre-seed a session or cause a victim to bind a token to the attacker's session. Confusion with the main app session can also carry old privileges forward.
- **mitigation:** On magic-link exchange, ignore any existing portal session, rotate the session identifier, bind it to the exchanged token and actor, and set a fresh cookie with strict attributes. Regenerate session on privilege changes and logout.
- **plan_change:** YES - define explicit session rotation semantics in the auth flow.

### 6. IDOR by enumerating claim, document, or receipt IDs

- **severity:** HIGH
- **description:** Claims, documents, receipts, submissions, and payments are high-value targets. If routes like `/health-hub/claims/:id` or server actions fetch by ID without actor-scoped joins, sequential or leaked IDs can expose another patient's files.
- **mitigation:** Use opaque UUIDs plus mandatory authorization joins. Never use direct object IDs alone as proof of access. Add integration tests that attempt to read, update, delete, download, and submit objects from another patient/household.
- **plan_change:** YES - require object-scope authorization utilities and test fixtures for cross-scope denial.

### 7. CSRF on Next.js server actions that mutate Health Hub state

- **severity:** HIGH
- **description:** Server actions and route handlers that submit claims, upload metadata, send emails, change claim state, or approve extracted fields can be invoked from another origin if they rely only on cookies. SameSite helps, but should not be the only control for medical and financial mutations.
- **mitigation:** Require CSRF tokens or origin checks for all cookie-authenticated mutations. Set cookies to `SameSite=Lax` or `Strict` where feasible, validate `Origin` and `Host`, and use POST-only endpoints with idempotency keys.
- **plan_change:** YES - add CSRF middleware/contracts to Health Hub server-action flows.

### 8. Admin cookie and `hh_session` cookie confusion or collision

- **severity:** HIGH
- **description:** The main app admin cookie and Health Hub `hh_session` may overlap in name, path, domain, SameSite, or middleware interpretation. A portal user could be treated as admin, or an admin route could accidentally honor a weaker portal session.
- **mitigation:** Use distinct cookie names, paths, domains, signing keys, session stores, and middleware branches. Admin routes must explicitly reject `hh_session`; portal routes must not accept admin cookies unless an intentional admin-impersonation flow with audit exists.
- **plan_change:** YES - specify cookie scope, middleware order, and separate session verification functions.

### 9. Service-role key accidentally reachable from client/runtime logs

- **severity:** MED
- **description:** Supabase service-role keys, Gmail OAuth refresh tokens, and Vertex credentials are catastrophic if bundled client-side or logged during exception handling. Next.js environment variable naming mistakes can expose secrets with `NEXT_PUBLIC_` or client imports.
- **mitigation:** Keep all privileged clients in server-only modules, add build-time secret scanning, prevent `NEXT_PUBLIC_` use for secrets, redact env values in logs, and fail CI if service-role imports appear in client components.
- **plan_change:** NO - implementation hardening and CI checks, assuming no API contract changes.

### 10. Overbroad Supabase RLS bypass for server-side convenience APIs

- **severity:** MED
- **description:** A common shortcut is using the service role for all server-side Health Hub queries. That bypasses RLS and makes every missed authorization check a production data leak.
- **mitigation:** Use user-scoped Supabase clients wherever possible. If service role is required, isolate it behind tiny repository functions that require an explicit actor and scope. Add tests that assert RLS denies direct access and repository functions deny cross-scope access.
- **plan_change:** YES - define a service-role access layer and actor/scope arguments for privileged functions.

## LGPD / Privacy

### 11. Medical data overexposed in emails to Celina and email logs

- **severity:** HIGH
- **description:** Auto-email bodies may include diagnosis, procedure details, full receipts, patient names, claim amounts, links, or attachments. Gmail sent mail, provider logs, app email logs, and bounce logs can retain sensitive medical data beyond the app's controls.
- **mitigation:** Minimize email body content to operational metadata and a portal link. Avoid diagnosis/procedure text in subject/body. Store only delivery metadata in email logs unless a legal basis exists for full body retention. Prefer no attachments; require portal auth for documents.
- **plan_change:** YES - change outbound email template and logging schema to separate delivery metadata from sensitive content.

### 12. Missing retention, erasure, and purge policy across tables and buckets

- **severity:** HIGH
- **description:** The right to erasure and storage limitation require clear retention windows. Health Hub touches claims, documents, receipts, OCR text, Gemini prompts/responses, email logs, audit logs, sessions, magic-link tokens, Storage objects, payment reconciliations, and migration staging tables. Without TTL or purge logic, sensitive data will accumulate indefinitely.
- **mitigation:** Define retention per data class. Suggested defaults: expire magic links quickly; purge session records after inactivity; purge extraction staging after claim finalization plus short dispute window; retain audit logs only as long as legally justified; define user erasure workflow that deletes or anonymizes all patient-linked rows and Storage paths.
- **plan_change:** YES - add retention columns, purge jobs, Storage deletion workflow, and erasure dependency map.

### 13. Lawful basis unclear per data category

- **severity:** HIGH
- **description:** The plan needs a lawful basis for each data category: patient identity, contact data, medical documents, diagnosis/procedure text, financial reimbursement amounts, bank/payment data, audit logs, AI extraction, and emails to Celina. Using "legitimate interest" for sensitive health data may be insufficient without explicit consent or another LGPD exception.
- **mitigation:** Create a data processing register. For each category, document controller/processor roles, purpose, lawful basis, retention, recipients, and withdrawal/erasure handling. Gate Health Hub onboarding on explicit consent where required, especially for sharing with Celina and processing through Vertex/Gemini.
- **plan_change:** YES - add consent capture/versioning and data-category policy metadata before collection.

### 14. Incomplete who-saw-what audit trail

- **severity:** HIGH
- **description:** If the app only audits edits, it cannot answer who viewed, downloaded, emailed, exported, or submitted a medical document. LGPD incidents often hinge on access visibility, not just mutation history.
- **mitigation:** Add append-only audit events for view, preview, download, signed-URL issuance, email sent, portal login, magic-link exchange, claim submission, extraction approval, payment reconciliation, and admin/support access. Include actor, role, patient_id, object_id, event type, timestamp, IP/user-agent where appropriate, and reason for break-glass access.
- **plan_change:** YES - add audit table/event model and call sites across read and write flows.

### 15. Diagnosis text stored as ordinary claim metadata

- **severity:** HIGH
- **description:** Diagnosis, procedure notes, prescriptions, and OCR text are sensitive health data. If stored in generic claim notes or email logs, they may be over-indexed, over-retained, broadly visible, and included in analytics or exports.
- **mitigation:** Classify fields by sensitivity. Store diagnosis/procedure text in a restricted table or encrypted column with stricter access checks, retention, and redaction rules. Prefer structured minimal codes/flags where operationally sufficient.
- **plan_change:** YES - split sensitive medical fields from ordinary claim metadata and update UI/API visibility rules.

### 16. Cross-border transfer to Google Vertex/Gemini lacks LGPD transfer basis

- **severity:** HIGH
- **description:** Sending receipts, prescriptions, diagnosis text, or OCR content to Vertex/Gemini may transfer personal and sensitive medical data to Google infrastructure outside Brazil, including France/US depending on configuration. The plan needs a transfer mechanism and processor terms.
- **mitigation:** Confirm Google Cloud data residency, subprocessors, DPA, transfer mechanism, and whether data is retained for abuse monitoring or model improvement. Prefer regional endpoints where available, minimize prompts, redact fields before calls, and capture consent/notice for AI processing and cross-border transfer.
- **plan_change:** YES - add AI processing notice/consent, prompt minimization, region configuration, and vendor governance gate.

### 17. Prompt and model-output logs retain sensitive medical data

- **severity:** MED
- **description:** Even if the app database is minimized, prompts, raw OCR, Gemini responses, trace logs, and error payloads may retain full medical documents or extracted diagnosis text in Vercel, Google Cloud, Supabase logs, or observability tooling.
- **mitigation:** Disable verbose prompt logging in production, redact structured fields before logging, store raw extraction payloads only in short-lived staging tables, and ensure observability tools have retention and access controls aligned to health data.
- **plan_change:** YES - add extraction staging retention and logging redaction requirements to the AI flow.

### 18. Support/debug access exposes patient medical data without break-glass controls

- **severity:** MED
- **description:** Developers or admins debugging extraction failures may access documents and sensitive fields through dashboards or service-role scripts. Without explicit break-glass, access is invisible and unconstrained.
- **mitigation:** Require reason-coded support access, short-lived elevated grants, audit events, and least-privilege admin tooling. Avoid direct dashboard reads for medical Storage buckets except under documented incident procedures.
- **plan_change:** YES - add support-access flow and audit reason fields.

## Failure Modes

### 19. Gmail send failure or double-send breaks claim submission

- **severity:** HIGH
- **description:** Gmail can fail due to bounce, quota, expired OAuth refresh token, SMTP/API outage, or recipient rejection. Retries can also double-send a claim packet, causing duplicate insurer submissions or confusion for Celina.
- **mitigation:** Model email sending as an outbox with idempotency keys, provider message IDs, retry state, failure reason, and manual resend controls. Separate "claim ready" from "email sent" from "submission acknowledged." Alert on permanent failures and OAuth expiry.
- **plan_change:** YES - add email outbox/status table and idempotent send flow.

### 20. Scan misrecognition changes amount, provider, or patient

- **severity:** HIGH
- **description:** OCR/Gemini may misread amount, provider, date, CNPJ, patient name, or invoice number. A wrong field can submit an invalid claim, over/understate reimbursement, or leak one patient's document into another patient's workflow.
- **mitigation:** Require human review for extracted key fields before submission. Show image snippets next to extracted values, keep confidence indicators as advisory only, and block submission when critical fields are missing or inconsistent with existing patient/provider data.
- **plan_change:** YES - add extraction review/approval state and required-field validation gates.

### 21. Dedup false-merge or false-split corrupts reimbursement state

- **severity:** HIGH
- **description:** Two different NFs can look similar and be merged, losing a claim. The same NF can be imported twice and split into duplicate claims, causing double submission or wrong reconciliation.
- **mitigation:** Use deterministic dedup candidates based on provider identifier, NF number, issue date, amount, patient, and file hash, but require human confirmation for ambiguous matches. Store dedup decisions and allow undo/split/merge operations with audit.
- **plan_change:** YES - add dedup candidate table/decision state and reversible merge/split flow.

### 22. NF mapped to the wrong family member

- **severity:** HIGH
- **description:** A family may contain multiple patients with similar names, accents, aliases, or shared providers. OCR may infer the wrong patient, especially when an NF contains parent payer data instead of patient data.
- **mitigation:** Make patient selection explicit on import unless the match is deterministic and already verified. Store both extracted patient text and confirmed `patient_id`. Add warnings for low-confidence or conflicting payer/patient names.
- **plan_change:** YES - keep extracted patient text separate from confirmed `patient_id` and add review UI.

### 23. Deadline miscalculation by timezone, business-day, or insurer rule

- **severity:** HIGH
- **description:** Submission deadlines can depend on calendar days, business days, insurer-specific rules, issue date, service date, rejection/amendment date, holidays, and timezone. A wrong deadline can cause irreversible reimbursement loss.
- **mitigation:** Store insurer-specific deadline policy versions and calculate deadlines server-side using the relevant timezone and holiday calendar. Persist the calculated deadline, source rule version, and manual override reason. Surface overdue and past-deadline states explicitly.
- **plan_change:** YES - add insurer deadline rules, deadline snapshot fields, and override workflow.

### 24. Partial-payment reconciliation marks claims incorrectly

- **severity:** HIGH
- **description:** An insurer may pay only part of a claim, combine several claims into one transfer, or pay in installments. A simple paid/unpaid flag will misstate balances and may close claims prematurely.
- **mitigation:** Model payments as allocations: `payment_transfers` linked to one or more `claim_payment_allocations`, with amount, currency, exchange rate, allocation status, and residual balance. Claim state should derive from allocations, not a single payment flag.
- **plan_change:** YES - add transfer/allocation model and residual-balance state.

### 25. BRL/EUR exchange-rate source, snapshot, or rounding error

- **severity:** MED
- **description:** If expenses or reimbursements cross BRL/EUR, the rate source, timestamp, rounding precision, and payer policy matter. Recomputing historical amounts with today's rate will corrupt records.
- **mitigation:** Snapshot exchange rate, source, timestamp, base currency, quote currency, precision, and rounding method at claim creation and at payment allocation. Permit manual override with audit when insurer uses a different rate.
- **plan_change:** YES - add exchange-rate snapshot fields to claim/payment records.

### 26. Supabase Storage migration loses medical documents

- **severity:** HIGH
- **description:** Changing bucket layout, path conventions, or metadata during schema changes can orphan files, break links, overwrite receipts, or lose medical documents. Storage objects are often outside transactional database migrations.
- **mitigation:** Use a two-phase migration: inventory all objects, copy to new paths, verify checksums and row references, run dual-read compatibility, then cut over and delete only after retention window. Keep a rollback manifest.
- **plan_change:** YES - add migration manifest/checksum process and dual-read compatibility period.

### 27. Gemini extraction hallucination treated as authoritative

- **severity:** HIGH
- **description:** Gemini may return confident but wrong field values, invent missing invoice numbers, normalize names incorrectly, or infer diagnosis/procedure data not present. Confidence scores do not eliminate hallucination risk.
- **mitigation:** Treat AI output as proposed data. Persist raw extraction separately, mark generated fields as unverified, require human approval for critical fields, and validate against document text snippets, known providers, patient roster, and arithmetic checks.
- **plan_change:** YES - add AI provenance, verification state, and approval flow.

### 28. Import retry creates duplicate claims, documents, or emails

- **severity:** MED
- **description:** A failed upload, timed-out extraction, or retried server action can create multiple database rows, duplicate Storage files, or multiple emails for the same claim packet.
- **mitigation:** Use idempotency keys per upload/import/send, unique constraints on stable document fingerprints where possible, and transactional state transitions. Retries should resume from the last completed step.
- **plan_change:** YES - add idempotency keys and resumable import state.

## Vercel Deploy

### 29. Serverless timeout during cold start plus OCR/Gemini latency

- **severity:** HIGH
- **description:** Vercel serverless functions may time out during upload parsing, PDF/image preprocessing, cold start, OCR, and Gemini calls. A user may see failure while backend work continues or partially commits.
- **mitigation:** Move extraction to an async job pattern. Upload first, create an import job, enqueue processing, and poll/subscribe for status. Keep synchronous requests limited to validation and job creation. Configure function duration intentionally but do not rely on long request/response processing.
- **plan_change:** YES - change upload/extraction from synchronous flow to job-based processing.

### 30. No persistent filesystem on Vercel for uploaded PDFs/images

- **severity:** MED
- **description:** Vercel functions cannot rely on durable local disk. Large PDFs/images temporarily written during OCR or upload can disappear between invocations or exceed `/tmp` limits.
- **mitigation:** Stream uploads directly to Supabase Storage or use bounded `/tmp` only for short-lived processing within one invocation. Record Storage object metadata before extraction and re-read from Storage for background jobs.
- **plan_change:** NO - implementation detail if the architecture already uploads before processing.

### 31. Production Storage bucket and RLS wiring differs from development

- **severity:** HIGH
- **description:** A private bucket in development can become public in production, RLS policies can be missing, or service-role-only paths can bypass intended restrictions. Miswired buckets are a direct medical-data breach.
- **mitigation:** Define bucket names, privacy flags, RLS policies, and path conventions as migration-managed infrastructure. Add deployment checks that assert buckets are private and policies deny anonymous access. Test signed URL issuance under production-like roles.
- **plan_change:** YES - add Storage policy migrations/checks and environment parity requirements.

### 32. Secret handling for Gmail OAuth, Supabase service role, Vertex SA key

- **severity:** HIGH
- **description:** Gmail OAuth refresh tokens, Supabase service role, and Vertex service account credentials are high-impact secrets. Misconfiguration can leak medical data, send fraudulent emails, or compromise the database.
- **mitigation:** Store secrets only in Vercel encrypted env vars or a secrets manager; restrict Vertex service account permissions; rotate on deploy personnel changes; never expose to client bundles; add secret scanning and redaction. Prefer Workload Identity Federation if feasible over raw long-lived keys.
- **plan_change:** NO - deployment/security hardening unless the plan currently requires client-side use.

### 33. Unsafe migration ordering and backfills

- **severity:** HIGH
- **description:** Backfilling `patient_name -> patient_id` can attach old claims to the wrong patient if names are ambiguous. Backfilling `claim_state` can mark claims as submitted, paid, or closed incorrectly if historical data is incomplete.
- **mitigation:** Use expand/backfill/contract migrations. Add nullable columns first, run audited backfill into staging fields, review ambiguous matches, then enforce NOT NULL/foreign keys. For `claim_state`, compute from source events where available and mark uncertain rows as `needs_review`.
- **plan_change:** YES - add migration staging/review states and avoid automatic destructive contraction.

### 34. No rollback plan for broken production migration

- **severity:** HIGH
- **description:** If a schema or Storage migration breaks Health Hub in production, simply reverting code may not restore old paths, states, or data shape. Medical claim deadlines can be missed during outage.
- **mitigation:** For each migration, write a rollback/roll-forward plan, backup point, validation query set, and feature flag. Use backward-compatible deploys where code can read both old and new schemas until cutover is confirmed.
- **plan_change:** YES - require feature flags, compatibility reads, and migration runbooks.

### 35. Existing local Task Scheduler job conflicts with cloud cron replacement

- **severity:** MED
- **description:** If an existing weekly Task Scheduler job on a local machine continues after Vercel/Supabase cron is introduced, imports, email sends, or reconciliation jobs can run twice. If it is disabled too early, no scheduled processing may run.
- **mitigation:** Create a cutover plan with a single scheduler of record, job-level idempotency, run ledger, and monitoring. Disable the local task only after cloud cron has run successfully and produced expected ledger entries.
- **plan_change:** YES - add scheduler run ledger and idempotent job design.

## Edge Cases

### 36. One payment reimburses multiple NFs

- **severity:** HIGH
- **description:** An insurer transfer may reimburse several NFs at once. If the plan assumes one payment per NF or one payment per claim, reconciliation will either duplicate payment amounts or close the wrong claim.
- **mitigation:** Model payments independently from claims and allocate portions to claims/NFs. Support many-to-many allocation with residual amounts and audit.
- **plan_change:** YES - add payment allocation model.

### 37. One NF maps to multiple claims

- **severity:** HIGH
- **description:** A single NF may cover several procedures, claim periods, patients, or insurer categories. If one NF can belong to only one claim, users may duplicate files or misrepresent claim contents.
- **mitigation:** Separate source documents from claim line items. Let one document attach to multiple claim items with allocation amounts and service-date ranges.
- **plan_change:** YES - add claim line items and document-to-line-item join table.

### 38. Receipt without CNPJ cannot be identified or deduped

- **severity:** MED
- **description:** Informal providers or certain receipts may lack CNPJ. Dedup and provider validation based only on CNPJ will fail, and the UI may block legitimate claims.
- **mitigation:** Allow provider records with nullable CNPJ plus alternate identifiers: provider name, CPF if legally appropriate, address, phone, specialty, and manual verification status. Dedup should fall back to composite fuzzy matching with human confirmation.
- **plan_change:** YES - allow nullable provider tax ID and add manual provider verification.

### 39. One prescription covers multiple NFs across dates

- **severity:** MED
- **description:** A prescription can support multiple purchases or services over time. If prescriptions are attached one-to-one to an NF or claim, users may re-upload duplicates or lose traceability across claims.
- **mitigation:** Model prescriptions as reusable supporting documents with validity dates, prescribing provider, patient, and links to multiple NFs/claim items. Track when the same prescription is reused.
- **plan_change:** YES - add supporting-document relationship independent of a single claim.

### 40. Claim is already past deadline at import time

- **severity:** MED
- **description:** A user may import an old NF after the insurer deadline. If the app silently treats it as normal, Celina may waste time or submit an invalid claim.
- **mitigation:** Calculate deadline at import, show `past_deadline` state, require explicit override to submit, and capture reason if a user still proceeds.
- **plan_change:** YES - add past-deadline state and override flow.

### 41. Insurer pays partial amount or installments across transfers

- **severity:** HIGH
- **description:** Installments or partial reimbursements mean a claim can be partially paid, underpaid, disputed, or still awaiting additional transfers. A binary `paid` state is insufficient.
- **mitigation:** Use payment allocations and derived claim balance. Add statuses such as `partially_paid`, `underpaid`, `awaiting_installment`, and `closed_with_shortfall`.
- **plan_change:** YES - extend claim state machine and payment model.

### 42. Re-sending after rejection: new submission vs amendment

- **severity:** HIGH
- **description:** After rejection, resubmission may be treated by the insurer as an amendment, appeal, or new claim. If the system overwrites the original submission, auditability and deadlines are lost.
- **mitigation:** Model submission attempts separately from claims. Preserve original packet, rejection reason, corrected documents, sent timestamp, recipient, and relation between attempts.
- **plan_change:** YES - add `claim_submissions`/attempt model and rejection/resubmission flow.

### 43. Ayelet is both secretary/app user and patient

- **severity:** HIGH
- **description:** A family member can be both an app user/secretary and a patient. If identity, role, and patient records are conflated, Ayelet may gain access to other patients by being a secretary, or lose access to her own patient documents because she is treated only as staff.
- **mitigation:** Separate `users`, `people/patients`, and `access_grants`. A user may link to a patient profile but permissions must still be scoped by role and relationship. Add tests for same-person multi-role access.
- **plan_change:** YES - make identity-to-patient linkage explicit and support multi-role actors.

## Cross-Cutting Required Changes

The following changes are the strongest blockers before implementation:

1. **Explicit access model:** add patient/household/claim-scoped grants, capability-based roles, object-scoped authorization checks, and separate admin vs portal session validation.
2. **Audited document access:** replace durable emailed document links with authenticated, short-lived, logged download mediation.
3. **AI verification workflow:** treat Gemini output as unverified suggestions, store provenance, and require human approval for critical fields.
4. **Privacy controls:** add consent/versioning, data classification, retention/purge jobs, and cross-border transfer governance.
5. **Claim/payment data model:** split documents, claim line items, submissions, payment transfers, and payment allocations instead of assuming one-to-one relationships.
6. **Async processing:** use job-based import/extraction/email flows with idempotency and retry state rather than synchronous serverless requests.
7. **Migration and deployment safety:** use expand/backfill/contract migrations, review ambiguous backfills, Storage manifests, feature flags, and rollback runbooks.
