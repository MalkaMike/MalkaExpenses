# Health Hub - Final Buildable Plan (Round 5)

> Status: FINAL - supersedes rounds 1-4. Written 2026-06-06.
> Scope: personal family health reimbursement tracker, ~3 users (Mickael, Ayelet, Celina).
> Bias: simplicity. Real security and LGPD basics included.

---

## 1. Reconciled Decisions

### Decision 1: Celina Access Model

**Decision:** Adopt Round 2 simplification. Celina (health_secretary) sees all claims in her queue and can take two actions: confirm received, confirm sent. Every access is recorded in health_access_log with actor, timestamp, IP address, and claim. No per-patient RLS in v1.

**Rationale:** Round 4 proposed per-patient RLS scoping, but this is over-engineered for a 3-user app with 1 secretary and 5 patients. Overhead of managing per-patient grant rows outweighs the benefit when the trust boundary is clear: Celina is a named, trusted family secretary. The audit log provides accountability without the complexity. Per-patient RLS becomes relevant only if a second secretary is added with a different trust level - that is the trigger to implement it, not before.

### Decision 2: Claim Cardinality

**Decision:** Keep 1 claim = 1 NF as the v1 default. One claim maps to exactly one NF/recibo, one payment record, and one prescription document.

**Rationale:** Matches the real data pattern. One medical service = one NF, one bank charge, one prescription. The existing installment-aware nota_fiscal_payments table handles 1 payment to many installments already. Multi-NF-per-claim is a future join table option, not v1. One-payment-covers-multiple-NFs (Risk R36) is handled by recording the EUR receipt against each claim individually and noting any partial amount in the receipt notes field.

### Decision 3: Round 4 Adoptions

**(a) AI human_confirmed flag:** All AI-extracted fields (patient name, provider, amount, service date, document type) carry human_confirmed boolean defaulting to false. Gemini output is unverified suggestions requiring explicit human review before saving. No claim action uses an unconfirmed AI field without human approval.

**(b) Magic-link security:** Single-use tokens, 15-minute expiry (already Round 3 spec, confirmed). Double-use revokes the session and triggers a security alert to Mickael.

**(c) Signed URLs:** 1-hour expiry for all document download endpoints. Exception: email fallback links use 7-day expiry when attachments exceed 20MB (recipient is a verified named user; links not indexed). Durable document links are never embedded in emails or logs.

**(d) LGPD / cross-border AI:** Mickael is the data controller of his own family health data. Processing by Vertex AI/Gemini falls under the standard Google Cloud Data Processing Addendum. Not a blocker - documented fact. See Section 6.

---

## 2. Phased Roadmap

### M0 - Foundation (S, ~1 week)

**Ships:**
- DB migrations: app_users, app_login_challenges, app_auth_sessions, health_family_members, health_access_log
- hh_session cookie: getHealthHubActor(), assertHealthHubPermission(), Next.js middleware for /health-hub/*
- Seed: 3 app_users (Mickael health_admin, Ayelet health_member, Celina health_secretary)
- Seed: 5 health_family_members (Mickael, Ayelet, Lavi, Lya, Mila)
- Column additions to reimbursement_claims: patient_id, claim_state, eligibility_confirmed

**Why:** Nothing else is buildable without the auth layer and patient identity. Zero UI - pure foundation.
**Dependencies:** None. **Effort:** S

---

### M1 - Manual Claim Assembly + Email Loop (M, ~2 weeks)

**Ships:**
- /health-hub home screen: work queue by state and missing part
- /health-hub/claims/[id] assembly screen: attach NF + prescription + payment, readiness status
- /health-hub/login magic-link login flow (request + verify + session)
- /health-hub/queue Celina queue: confirmClaimReceived + confirmClaimSent
- State machine: draft -> needs_documents -> ready_to_submit -> emailed_to_secretary -> secretary_received -> secretary_sent -> money_received
- health_email_outbox + outbox worker: Gmail send via gmail.send scope, summary sheet, idempotency guard
- health_claim_state_audit: every transition logged
- Deadline tracking: deadline_anchor_date + filing_deadline_date from insurance_policies
- Ready-to-submit computation: deterministic check of all 3 parts + deadline not expired

**Why:** Core value delivered. Full manual loop works end-to-end: Mickael assembles, app emails Celina, Celina confirms, Mickael records EUR receipt. Everything after M1 is enhancement.
**Dependencies:** M0. **Effort:** M

---

### M2 - AI-Assisted Extraction (M, ~1-2 weeks)

**Ships:**
- health_ingestion_sessions + health_ingestion_files tables
- /health-hub/upload bulk drop: drag-and-drop many PDFs, sha256 dedup, async job processing
- /health-hub/scan mobile scan: camera capture -> upload -> OCR
- Gemini OCR async job: extract patient name, provider, amount, service date, document type
- human_confirmed review step: UI shows Gemini suggestions with confidence, user confirms or edits before saving
- health_patient_aliases + name matching: auto-accept score >= 0.92, queue 0.80-0.92 for /health-hub/mapping review screen
- human_confirmed column on nota_fiscais and medical_documents; patient_name_raw and patient_name_norm on nota_fiscais

**Why:** Reduces manual data entry. human_confirmed flag prevents automated decisions on medical data.
**Dependencies:** M1. **Effort:** M

---

### M3 - Claim Status + Money Tracking (S, ~1 week)

**Ships:**
- france_bank_accounts table + admin UI
- claim_reimbursement_receipts + /health-hub/claims/[id]/money-received form: record EUR amount + date + France account
- DeadlineBadge component: ok / due_soon (30-day warning) / expired / unknown
- Partial/rejected handling: claimed_amount_brl vs received EUR; re-send flow with new submission_version
- /health-hub/audit page: access log, sessions, state audit timeline

**Why:** Closes the reimbursement loop. Without EUR tracking, no way to verify amounts or catch partials.
**Dependencies:** M1. **Effort:** S

---

### M4 - Policy/Eligibility Engine (L, non-blocking parallel track)

**Ships:**
- health_policy_versions: versioned policy documents with effective dates
- health_eligibility_results: one result per claim per policy version with decision + amounts + reasons
- Policy rules function: evaluates service category, annual limits, prescription gate per policy version
- Policy admin UI: upload policy document, view eligibility results per claim
- Replaces eligibility_confirmed manual bypass with automated evaluation (bypass remains as override)

**Why:** Makes eligibility deterministic and auditable instead of a manual stub.
**Dependencies:** M1 data model (claim + patient + policy tables must exist). **Effort:** L
**Note:** Non-blocking. M1-M3 use the eligibility_confirmed manual bypass stub throughout. M4 runs as a separate workstream and does not gate any other phase.

---

## 3. Minimal Data Model Delta (v1 only)

> Covers M0-M3. M4 adds health_policy_versions and health_eligibility_results separately.
> Existing tables (reimbursement_claims, medical_documents, nota_fiscais, nota_fiscal_payments, insurance_policies) unchanged unless column additions listed below.

### New Tables

```sql
-- Auth
app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null,
  roles text[] not null default '{}',
  is_active bool not null default true,
  secretary_token_hash text,
  created_at timestamptz not null default now()
)

app_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  challenge_hash text not null, expires_at timestamptz not null, consumed_at timestamptz,
  attempt_count int not null default 0, ip_address inet, user_agent text,
  created_at timestamptz not null default now()
)

app_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  session_token_hash text not null unique,
  roles text[] not null default '{}',
  expires_at timestamptz not null, last_seen_at timestamptz, revoked_at timestamptz,
  ip_address inet, created_at timestamptz not null default now()
)

-- Patient identity
health_family_members (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null, display_name text not null, relationship_to_mickael text,
  date_of_birth date, insurer_member_id text, notes text,
  created_at timestamptz not null default now()
)

health_patient_aliases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references health_family_members(id),
  alias_raw text not null, alias_norm text not null,
  source text not null,  -- manual | backfill | ocr
  confidence numeric(4,3), created_by uuid references app_users(id),
  created_at timestamptz not null default now()
)

-- Document intake (M2)
health_ingestion_sessions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,  -- bulk_drop | single_upload | weekly_batch | scanner
  created_by uuid references app_users(id),
  status text not null default 'pending',
  started_at timestamptz, finished_at timestamptz, error_detail text
)

health_ingestion_files (
  id uuid primary key default gen_random_uuid(),
  ingestion_session_id uuid not null references health_ingestion_sessions(id),
  original_file_name text, storage_bucket text, storage_path text, sha256 text,
  mime_type text, byte_size bigint,
  document_type_guess text,  -- nota_fiscal | recibo | prescription | unknown
  processing_status text not null default 'pending',
  dedup_status text,  -- new | duplicate_file | needs_review
  parsed_document_id uuid, error_detail text,
  created_at timestamptz not null default now()
)

-- Audit
health_access_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid references app_users(id),
  actor_roles text[] not null default '{}',
  patient_id uuid references health_family_members(id),
  claim_id uuid references reimbursement_claims(id),
  entity_table text, entity_id uuid, action text not null, route text, ip_address inet,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
)

health_claim_state_audit (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references reimbursement_claims(id),
  from_state text, to_state text not null,
  actor_user_id uuid references app_users(id),
  reason text, metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
)

-- Email
health_email_outbox (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references reimbursement_claims(id),
  recipient_email citext not null,
  idempotency_key text not null unique,
  status text not null default 'queued',
  submission_version int not null default 1,
  payload jsonb not null default '{}',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz, failed_at timestamptz, failure_reason text, gmail_message_id text,
  created_at timestamptz not null default now()
)

health_email_send_log (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references health_email_outbox(id),
  claim_id uuid references reimbursement_claims(id),
  recipient_email citext not null, template_key text not null,
  provider_message_id text, subject text not null, status text not null,
  queued_at timestamptz not null default now(), sent_at timestamptz, error_message text
)

-- Money tracking (M3)
france_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_label text not null, bank_name text, iban_last4 text,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
)

claim_reimbursement_receipts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references reimbursement_claims(id),
  received_at timestamptz not null, amount_eur numeric(10,2) not null,
  france_bank_account_id uuid references france_bank_accounts(id),
  notes text, recorded_by uuid references app_users(id),
  created_at timestamptz not null default now()
)
```

### Column Additions to Existing Tables

**reimbursement_claims:**
- patient_id uuid references health_family_members(id)
- insurance_policy_id uuid references insurance_policies(id)
- claim_state text not null default "draft" (values: draft | needs_documents | ready_to_submit | emailed_to_secretary | secretary_received | secretary_sent | money_received | rejected | cancelled | closed)
- prescription_document_id uuid references medical_documents(id)
- eligibility_confirmed bool not null default false
- eligibility_status text not null default "not_evaluated"
- submission_version int not null default 1
- last_sent_submission_version int
- sent_to_celina_at timestamptz
- deadline_anchor_date date
- filing_deadline_date date
- claimed_amount_brl numeric(12,2)
- state_updated_at timestamptz
- state_updated_by uuid references app_users(id)

**nota_fiscais:**
- patient_id uuid references health_family_members(id)
- patient_name_raw text
- patient_name_norm text
- human_confirmed bool not null default false

**medical_documents:**
- patient_id uuid references health_family_members(id)
- human_confirmed bool not null default false
- prescription_valid_from date
- prescription_valid_until date

---

## 4. Build Workstreams

1. **Infra:** Create Supabase private storage buckets (health-documents, health-generated) with RLS denying anonymous access. Set Vercel env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, HEALTH_HUB_SESSION_SECRET, HEALTH_HUB_EMAIL_CELINA.

2. **Schema (M0):** Expand/backfill/contract migrations: add nullable columns first, run audited backfill (patient_id from existing claim data), enforce NOT NULL after review, commit migration runbooks with rollback plans. Backfill claim_state from existing status; uncertain rows default to needs_documents.

3. **Auth (M0):** hh_session cookie infrastructure: getHealthHubActor(), assertHealthHubPermission(), Next.js middleware for /health-hub/*. Magic-link endpoints: POST /api/health-hub/auth/request-link and GET /api/health-hub/auth/verify. Celina fallback: secretary_token_hash at /api/health-hub/auth/secretary. Logout and session revocation endpoints.

4. **Core API (M1):** Claim CRUD server actions (createClaim, updateClaimAssembly, attachDocument). Ready-to-submit computation function (deterministic, checks all 3 parts + deadline). State machine transition actions with health_claim_state_audit writes and health_access_log writes on every access. assertHealthHubPermission() called at the top of every action.

5. **UI Mickael/Ayelet (M1):** /health-hub home with work queue grouped by missing part and by state. /health-hub/claims/[id] assembly screen: attach/detach NF, prescription, payment; readiness indicator; deadline badge; send button with manual approval. /health-hub/upload bulk drop page shell (M2 completes it).

6. **UI Celina (M1):** /health-hub/login magic-link login page. /health-hub/queue: list claims in emailed_to_secretary or secretary_received state, with Confirm received and Confirm sent to insurer buttons.

7. **AI integration (M2):** Async Gemini OCR job triggered after file upload: extract patient name, provider, amount, service date, document type. Human review step in UI: show extraction suggestions with confidence, user confirms or edits each field before human_confirmed = true is set. Patient alias matching: normalize name, match against health_patient_aliases, auto-accept score >= 0.92, queue score 0.80-0.92 for /health-hub/mapping review screen.

8. **Email (M1):** Gmail gmail.send OAuth re-consent flow for Mickael. Outbox worker (Vercel cron every 2 min): pick queued outbox rows, send via Gmail API, mark sent, write to health_email_send_log. Summary sheet PDF generation (21 required fields). Signed-link fallback when attachments exceed 20MB (7-day links, access logged in health_access_log).

9. **Money tracking + deadline (M3):** EUR receipt form on claim detail. DeadlineBadge component (ok / due_soon / expired / unknown). Partial reimbursement: compare claimed_amount_brl vs received EUR; display shortfall. Rejected claim re-send: increment submission_version, require Mickael approval, new idempotency key. /health-hub/audit page: access log + sessions + state audit timeline.

10. **Testing:** Unit tests for ready-to-submit computation (all gate combinations). Integration test: email idempotency guard (same claim + version = no double send). Negative IDOR tests: Ayelet session cannot read Mickael-only claims; Celina session cannot access finance routes. Migration dry-run validation: row counts, hash parity, foreign key integrity before cutover.

---

## 5. Open Decisions for Mickael

| # | Question | Recommended default |
|---|---|---|
| 1 | Celina email address for claim submissions | No default - Mickael must provide before M1 email goes live |
| 2 | Email format: attach files or use signed links | Attach when total payload under 20MB; signed-link fallback for oversized |
| 3 | Auto-send when claim ready vs manual Mickael approval click | Manual approval click for v1 (safer, easier to debug and audit) |
| 4 | Which Gmail account re-consents the gmail.send scope | Mickael primary Gmail |
| 5 | Canonical names and NF spelling aliases for Lavi, Lya, Mila | No default - Mickael must confirm all observed NF spellings and nicknames |
| 6 | Known medical provider CNPJs or names to seed the provider list | Optional - no default; provide when available |
| 7 | Which document categories require a prescription before reimbursement | All categories for v1; relax per policy document when available |
| 8 | Policy document: annual/monthly limits, filing window months, category taxonomy | Stub bypass (eligibility_confirmed manual) until Mickael provides policy |
| 9 | Eligibility bypass action visible to Ayelet or Mickael only | Mickael only (Ayelet should not mark her own claims eligible) |
| 10 | Local file paths with existing health documents for Supabase Storage migration | No default - Mickael must list paths; run migration after M0 schema stable |

---

## 6. LGPD / Security Baseline

Mickael Malka is the data controller for this application, which processes health data belonging to members of his household for the sole purpose of tracking insurance reimbursement claims; the legal basis is the legitimate interest of the data controller in managing his family finances, and all data subjects are family members who have implicitly consented to this use. Magic-link authentication tokens are cryptographically random (32 bytes), single-use only, and expire after 15 minutes; any attempt to reuse a consumed token immediately revokes the associated session and sends a security alert email to Mickael. Signed URLs for document downloads expire after 1 hour with no exceptions for regular download endpoints; the only exception is email fallback links, which use a 7-day expiry because the email recipient is a named, verified user and the links are not publicly indexed - durable document links are never embedded in emails, stored in application logs, or exposed to client-side code. Gemini and Vertex AI process medical document text to extract structured fields; this constitutes a cross-border data transfer to Google Cloud covered by the standard Google Cloud Data Processing Addendum, which Mickael accepts by using the Google Cloud platform; all AI-extracted fields carry a human_confirmed boolean that defaults to false and must be set to true by a human reviewer before any field is used in claim assembly, ensuring no automated decision-making occurs on medical data. Every access to patient or claim data by any actor including Celina is recorded in health_access_log with actor user ID, roles, IP address, route, and timestamp, providing a complete audit trail for LGPD accountability under Lei 13.709/2018.
