# Health Hub Round 1 Architecture

## Source Basis and Assumptions

This round is an architecture and data-model specification only. It does not modify source code, auth code, or migrations.

Assumption boundary: the workspace execution layer failed before returning the contents of `docs/health-hub/REQUIREMENTS.md`, `lib/auth/admin.ts`, and `db/migrations/0018_health_reimbursement.sql`. This document is therefore grounded in the task brief's explicit facts: the app is Next.js 15 + Supabase + Vertex/Gemini, current auth is shared-password signed cookies `pf_admin` and `pf_household` through `getRole(): admin | household | public`, and the existing Health Hub schema includes `reimbursement_claims`, `medical_documents`, `nota_fiscais`, `nota_fiscal_payments`, and `insurance_policies`. If 0018 already contains any column listed below, keep the existing column and align its type/semantics instead of creating a duplicate.

Implementation assumptions:

- Route prefix for the new product surface is `/health-hub`.
- All new IDs are PostgreSQL `uuid` values generated with `gen_random_uuid()`.
- Timestamp columns use `timestamptz`.
- Money columns use `numeric(12,2)` unless explicitly stated otherwise.
- `citext` is available for case-insensitive email columns.
- Server-side route handlers and server actions remain the enforcement point. Supabase RLS can mirror these rules later, but this design does not depend on direct browser access to Supabase tables.
- Existing finance/admin pages keep using `getRole()` and the `pf_admin` / `pf_household` cookies during the first implementation pass.

## 1. Auth and Roles Redesign

### Decision

Add named application accounts for Health Hub and keep the existing shared-cookie model for the current portal and finance/admin surfaces.

Do not extend `pf_admin` / `pf_household` to represent Celina or named Health Hub access. Shared cookies cannot support person-level LGPD audit logs, revocation, patient scoping, or "who confirmed sent/received" semantics. Instead, add a separate named Health Hub session cookie and helper:

- Keep existing `getRole()` unchanged for current routes.
- Add `hh_session`, an `httpOnly`, `Secure`, `SameSite=Lax` signed cookie containing an opaque session token.
- Add `getHealthHubActor()` for `/health-hub` routes. It resolves `hh_session` to a named user, roles, active patient scopes, and audit context.
- Add `assertHealthHubPermission(actor, action, resource)` in Health Hub server actions and API routes.

This minimizes disruption: old portal access keeps working, while Health Hub gets the named identities required for auditability.

### Named Users and Access

Initial account rows:

| Person | App roles | Existing cookie access | Effective access |
|---|---|---|---|
| Mickael | `admin`, `health_admin` | Keeps `pf_admin` | Full access to finance/admin, portal, and Health Hub |
| Ayelet | `household_portal`, `health_member` | Keeps existing household portal access through `pf_household` until that portal is migrated | Health Hub for authorized family members plus existing portal, no finance/admin |
| Celina | `health_secretary` | None | Health Hub only, scoped to assigned patients/claims, access logged |

### Middleware Gates

Middleware should be intentionally coarse and route-based:

- `/health-hub/:path*`
  - Require valid `hh_session`.
  - Require at least one of `health_admin`, `health_member`, or `health_secretary`.
  - Attach actor headers or request context for server handlers: `actor_user_id`, `actor_roles`, `request_id`.
  - Log route-level access for authenticated requests in `health_access_log` when the path can expose patient, claim, document, notification, or reimbursement data.
- `/admin/:path*`, `/finance/:path*`, `/api/admin/:path*`, `/api/finance/:path*`
  - Keep existing `getRole() === 'admin'` behavior.
  - Do not allow `hh_session` to grant finance/admin access.
- Existing household portal routes
  - Keep existing `getRole() === 'household' | 'admin'` behavior for Round 1.
  - Later migration can allow `app_user_roles.household_portal`, but that is not required for Health Hub.

### Per-Route Permission Gates

Every Health Hub route handler/server action must call `assertHealthHubPermission`.

Actions:

- `claim.create`
- `claim.read`
- `claim.read_sensitive`
- `claim.update_assembly`
- `claim.mark_ready`
- `claim.mark_submitted`
- `claim.mark_follow_up`
- `claim.mark_approved`
- `claim.mark_rejected`
- `claim.confirm_reimbursement_received`
- `claim.close`
- `claim.cancel`
- `document.upload`
- `document.read`
- `document.download`
- `patient.read`
- `patient.manage`
- `policy.manage`
- `notification.manage`
- `email.send`

Role rules:

- `health_admin`
  - All Health Hub actions for all patients and claims.
  - Can manage patients, policies, bank accounts, roles, and scopes.
- `health_member`
  - Can read, create, assemble, and upload documents for patients where `health_user_patient_access.access_level` is `member_read_write`.
  - Can edit draft and missing-document claims before submission.
  - Cannot mark claims as submitted, approved, rejected, reimbursed, closed, or cancelled after submission.
  - Cannot manage policies, bank accounts, users, or secretary scopes.
- `health_secretary`
  - Must have active `health_user_patient_access` for the claim's patient with `access_level = 'secretary_ops'`.
  - Can read only operational claim data needed for filing and reimbursement tracking.
  - Can mark ready claims as submitted/sent.
  - Can record insurer follow-up, approval, rejection, and reimbursement receipt data.
  - Can upload submission receipts, insurer response documents, and reimbursement statement documents.
  - Cannot create patients, edit family registry fields, edit policies, edit claimed BRL amounts, view finance/admin pages, export bulk data, or access claims outside active patient scope.
  - Every read, download, update, and email action is written to `health_access_log`.

Celina's scope is enforced twice:

1. Middleware blocks non-Health Hub surfaces.
2. Per-route permission checks verify both role and patient/claim scope before returning or mutating data.

## 2. Data Model

### PostgreSQL Types

```sql
create type app_role as enum (
  'admin',
  'household_portal',
  'health_admin',
  'health_member',
  'health_secretary'
);

create type health_patient_access_level as enum (
  'member_read_write',
  'secretary_ops',
  'read_only'
);

create type health_claim_status as enum (
  'draft',
  'needs_documents',
  'ready_to_submit',
  'submitted_to_insurer',
  'insurer_follow_up',
  'approved',
  'reimbursed_received',
  'rejected',
  'cancelled',
  'closed'
);

create type health_document_review_status as enum (
  'unreviewed',
  'accepted',
  'needs_clarification',
  'rejected'
);

create type health_deadline_anchor as enum (
  'service_date',
  'payment_date'
);

create type health_access_event_type as enum (
  'route_access',
  'claim_read',
  'claim_update',
  'document_read',
  'document_download',
  'patient_read',
  'receipt_create',
  'notification_create',
  'email_send'
);

create type health_notification_event_type as enum (
  'claim_missing_documents',
  'claim_ready_to_submit',
  'claim_deadline_due_soon',
  'claim_deadline_expired',
  'claim_submitted',
  'claim_follow_up_required',
  'claim_approved',
  'claim_rejected',
  'claim_reimbursement_received'
);

create type health_notification_channel as enum (
  'in_app',
  'email'
);

create type health_notification_status as enum (
  'pending',
  'queued',
  'sent',
  'failed',
  'read',
  'cancelled'
);

create type health_email_status as enum (
  'queued',
  'sent',
  'failed',
  'suppressed'
);

create type health_claim_document_role as enum (
  'submission_receipt',
  'insurer_response',
  'supplemental_medical',
  'reimbursement_statement'
);
```

### Auth Tables

#### `app_users`

Named people who can sign into application-specific surfaces.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `email` | `citext` | not null unique |
| `display_name` | `text` | not null |
| `is_active` | `boolean` | not null default `true` |
| `last_login_at` | `timestamptz` | nullable |
| `disabled_at` | `timestamptz` | nullable |
| `metadata` | `jsonb` | not null default `'{}'::jsonb` |
| `created_at` | `timestamptz` | not null default `now()` |
| `updated_at` | `timestamptz` | not null default `now()` |

#### `app_user_roles`

| Column | Type | Constraints / notes |
|---|---|---|
| `user_id` | `uuid` | not null references `app_users(id)` on delete cascade |
| `role` | `app_role` | not null |
| `created_by` | `uuid` | nullable references `app_users(id)` |
| `created_at` | `timestamptz` | not null default `now()` |

Primary key: `(user_id, role)`.

#### `app_auth_sessions`

Stores named login sessions for `hh_session`.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `user_id` | `uuid` | not null references `app_users(id)` on delete cascade |
| `session_token_hash` | `text` | not null unique |
| `created_at` | `timestamptz` | not null default `now()` |
| `expires_at` | `timestamptz` | not null |
| `last_seen_at` | `timestamptz` | nullable |
| `revoked_at` | `timestamptz` | nullable |
| `ip_address` | `inet` | nullable |
| `user_agent` | `text` | nullable |

#### `app_login_challenges`

Passwordless email-code login for named accounts.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `user_id` | `uuid` | not null references `app_users(id)` on delete cascade |
| `challenge_hash` | `text` | not null |
| `created_at` | `timestamptz` | not null default `now()` |
| `expires_at` | `timestamptz` | not null |
| `consumed_at` | `timestamptz` | nullable |
| `attempt_count` | `integer` | not null default `0` |
| `ip_address` | `inet` | nullable |
| `user_agent` | `text` | nullable |

### Family Member / Patient Registry

#### `health_family_members`

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `legal_name` | `text` | not null |
| `display_name` | `text` | not null |
| `preferred_name` | `text` | nullable |
| `relationship_to_mickael` | `text` | not null |
| `date_of_birth` | `date` | nullable |
| `cpf` | `text` | nullable |
| `email` | `citext` | nullable |
| `phone_e164` | `text` | nullable |
| `default_insurance_policy_id` | `uuid` | nullable references `insurance_policies(id)` |
| `insurance_member_number` | `text` | nullable |
| `country_of_care` | `char(2)` | not null default `'BR'` |
| `lgpd_consent_basis` | `text` | not null default `'family_health_reimbursement_management'` |
| `lgpd_consent_at` | `timestamptz` | nullable |
| `is_active` | `boolean` | not null default `true` |
| `created_at` | `timestamptz` | not null default `now()` |
| `updated_at` | `timestamptz` | not null default `now()` |

#### `health_user_patient_access`

Patient-level scope table. Celina must have an active row here for each patient she can handle.

| Column | Type | Constraints / notes |
|---|---|---|
| `user_id` | `uuid` | not null references `app_users(id)` on delete cascade |
| `patient_id` | `uuid` | not null references `health_family_members(id)` on delete cascade |
| `access_level` | `health_patient_access_level` | not null |
| `granted_by` | `uuid` | nullable references `app_users(id)` |
| `granted_at` | `timestamptz` | not null default `now()` |
| `expires_at` | `timestamptz` | nullable |
| `reason` | `text` | nullable |

Primary key: `(user_id, patient_id, access_level)`.

Active access means `expires_at is null or expires_at > now()`.

### France Bank Accounts

#### `france_bank_accounts`

Do not store a full IBAN unless the product later needs payouts. For reimbursement receipt tracking, a human-readable account label plus masked identifier is sufficient.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `account_label` | `text` | not null |
| `bank_name` | `text` | not null |
| `iban_last4` | `text` | not null |
| `currency` | `char(3)` | not null default `'EUR'` |
| `owner_user_id` | `uuid` | nullable references `app_users(id)` |
| `is_active` | `boolean` | not null default `true` |
| `created_at` | `timestamptz` | not null default `now()` |
| `updated_at` | `timestamptz` | not null default `now()` |

Check constraints:

- `currency = 'EUR'`
- `char_length(iban_last4) = 4`

### Existing Table Extensions

#### `insurance_policies`

Add reimbursement filing and assembly policy fields.

| Column | Type | Constraints / notes |
|---|---|---|
| `claim_filing_window_months` | `integer` | not null default `24`, check `> 0` |
| `claim_filing_window_anchor` | `health_deadline_anchor` | not null default `'service_date'` |
| `claim_filing_grace_days` | `integer` | not null default `0`, check `>= 0` |
| `requires_prescription` | `boolean` | not null default `true` |
| `requires_nota_fiscal` | `boolean` | not null default `true` |
| `requires_payment_proof` | `boolean` | not null default `true` |
| `submission_channel` | `text` | not null default `'email'` |
| `submission_email` | `citext` | nullable |

#### `medical_documents`

Add patient, review, and prescription validity metadata. Existing file storage columns stay unchanged.

| Column | Type | Constraints / notes |
|---|---|---|
| `patient_id` | `uuid` | nullable references `health_family_members(id)` |
| `document_date` | `date` | nullable |
| `review_status` | `health_document_review_status` | not null default `'unreviewed'` |
| `reviewed_by` | `uuid` | nullable references `app_users(id)` |
| `reviewed_at` | `timestamptz` | nullable |
| `contains_sensitive_health_data` | `boolean` | not null default `true` |
| `prescription_valid_from` | `date` | nullable |
| `prescription_valid_until` | `date` | nullable |

Required existing or normalized semantics:

- A document used as a prescription must have `document_type = 'prescription'`.
- `document_date` should be the prescription issue date when `document_type = 'prescription'`.

#### `nota_fiscais`

Add or confirm health-claim assembly fields. The NF is the source for the reimbursable service description.

| Column | Type | Constraints / notes |
|---|---|---|
| `patient_id` | `uuid` | nullable references `health_family_members(id)` |
| `service_date` | `date` | nullable |
| `service_description` | `text` | not null for claim-ready NFs |
| `currency` | `char(3)` | not null default `'BRL'` |
| `gross_amount_brl` | `numeric(12,2)` | nullable |
| `review_status` | `health_document_review_status` | not null default `'unreviewed'` |
| `reviewed_by` | `uuid` | nullable references `app_users(id)` |
| `reviewed_at` | `timestamptz` | nullable |

Check constraints:

- `currency = 'BRL'`
- `gross_amount_brl is null or gross_amount_brl > 0`

#### `nota_fiscal_payments`

The payment record is the source for the amount claimed in BRL and payment date. If 0018 already has equivalent columns under different names, normalize the application to these names rather than adding aliases.

| Column | Type | Constraints / notes |
|---|---|---|
| `nota_fiscal_id` | `uuid` | not null references `nota_fiscais(id)` |
| `amount_paid_brl` | `numeric(12,2)` | not null, check `> 0` |
| `paid_on` | `date` | not null |
| `payment_method` | `text` | nullable |
| `review_status` | `health_document_review_status` | not null default `'unreviewed'` |
| `reviewed_by` | `uuid` | nullable references `app_users(id)` |
| `reviewed_at` | `timestamptz` | nullable |

#### `reimbursement_claims`

This remains the central claim record. It should not duplicate NF, payment, prescription, patient, or policy details; it stores links, lifecycle state, deadline snapshots, and insurer-facing facts.

| Column | Type | Constraints / notes |
|---|---|---|
| `patient_id` | `uuid` | nullable references `health_family_members(id)` |
| `insurance_policy_id` | `uuid` | nullable references `insurance_policies(id)` |
| `claim_state` | `health_claim_status` | not null default `'draft'` |
| `state_updated_at` | `timestamptz` | not null default `now()` |
| `state_updated_by` | `uuid` | nullable references `app_users(id)` |
| `nota_fiscal_id` | `uuid` | nullable references `nota_fiscais(id)` |
| `nota_fiscal_payment_id` | `uuid` | nullable references `nota_fiscal_payments(id)` |
| `prescription_document_id` | `uuid` | nullable references `medical_documents(id)` |
| `claimed_amount_brl` | `numeric(12,2)` | nullable, check `claimed_amount_brl is null or claimed_amount_brl > 0` |
| `claim_currency` | `char(3)` | not null default `'BRL'` |
| `service_date` | `date` | nullable |
| `deadline_anchor_date` | `date` | nullable |
| `filing_deadline_date` | `date` | nullable |
| `deadline_computed_at` | `timestamptz` | nullable |
| `deadline_override_date` | `date` | nullable |
| `deadline_override_reason` | `text` | nullable |
| `deadline_override_by` | `uuid` | nullable references `app_users(id)` |
| `deadline_override_at` | `timestamptz` | nullable |
| `ready_to_submit_at` | `timestamptz` | nullable |
| `submitted_to_insurer_at` | `timestamptz` | nullable |
| `submitted_by` | `uuid` | nullable references `app_users(id)` |
| `insurer_submission_reference` | `text` | nullable |
| `approved_amount_eur` | `numeric(12,2)` | nullable, check `approved_amount_eur is null or approved_amount_eur >= 0` |
| `approved_at` | `timestamptz` | nullable |
| `rejected_at` | `timestamptz` | nullable |
| `rejection_reason` | `text` | nullable |
| `cancelled_at` | `timestamptz` | nullable |
| `cancel_reason` | `text` | nullable |
| `closed_at` | `timestamptz` | nullable |
| `last_notification_at` | `timestamptz` | nullable |

Check constraints:

- `claim_currency = 'BRL'`
- If `claim_state = 'submitted_to_insurer'`, then `submitted_to_insurer_at is not null`.
- If `claim_state = 'approved'`, then `approved_at is not null`.
- If `claim_state = 'rejected'`, then `rejected_at is not null`.
- If `claim_state = 'cancelled'`, then `cancelled_at is not null`.
- If `claim_state = 'closed'`, then `closed_at is not null`.

Recommended indexes:

- `reimbursement_claims(patient_id, claim_state)`
- `reimbursement_claims(filing_deadline_date) where claim_state in ('needs_documents', 'ready_to_submit')`
- `reimbursement_claims(nota_fiscal_payment_id) where claim_state not in ('cancelled', 'rejected')`

### Claim Receipt Tracking

#### `claim_reimbursement_receipts`

Tracks actual EUR reimbursement money received in France. One claim can have multiple receipt rows for partial payments.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `claim_id` | `uuid` | not null references `reimbursement_claims(id)` on delete cascade |
| `received_amount_eur` | `numeric(12,2)` | not null, check `> 0` |
| `received_on` | `date` | not null |
| `france_bank_account_id` | `uuid` | not null references `france_bank_accounts(id)` |
| `exchange_rate_brl_per_eur` | `numeric(12,6)` | nullable, check `exchange_rate_brl_per_eur is null or exchange_rate_brl_per_eur > 0` |
| `received_amount_brl_equivalent` | `numeric(12,2)` | nullable; set by app when exchange rate is known |
| `confirmed_by` | `uuid` | not null references `app_users(id)` |
| `confirmed_at` | `timestamptz` | not null default `now()` |
| `notes` | `text` | nullable |
| `created_at` | `timestamptz` | not null default `now()` |
| `updated_at` | `timestamptz` | not null default `now()` |

Comparison rule:

- Claimed amount is `reimbursement_claims.claimed_amount_brl`.
- Received EUR total is `sum(claim_reimbursement_receipts.received_amount_eur)`.
- BRL-equivalent comparison is optional and only shown when `exchange_rate_brl_per_eur` is available.
- A claim can move to `reimbursed_received` after at least one receipt is recorded. It is considered fully reconciled when `approved_amount_eur is null` or `sum(received_amount_eur) >= approved_amount_eur`.

### Claim Supplemental Documents

#### `health_claim_documents`

Maps non-primary documents to a claim. The primary NF/payment/prescription links remain direct columns on `reimbursement_claims`.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `claim_id` | `uuid` | not null references `reimbursement_claims(id)` on delete cascade |
| `document_id` | `uuid` | not null references `medical_documents(id)` on delete restrict |
| `document_role` | `health_claim_document_role` | not null |
| `added_by` | `uuid` | nullable references `app_users(id)` |
| `added_at` | `timestamptz` | not null default `now()` |

Unique constraint: `(claim_id, document_id, document_role)`.

### Claim State Audit

#### `health_claim_state_audit`

One row per state transition. It captures who, when, and what changed.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `claim_id` | `uuid` | not null references `reimbursement_claims(id)` on delete cascade |
| `from_state` | `health_claim_status` | nullable for claim creation |
| `to_state` | `health_claim_status` | not null |
| `actor_user_id` | `uuid` | nullable references `app_users(id)` |
| `actor_roles` | `app_role[]` | not null default `'{}'::app_role[]` |
| `actor_display_name` | `text` | nullable snapshot |
| `changed_at` | `timestamptz` | not null default `now()` |
| `reason` | `text` | nullable |
| `changed_fields` | `jsonb` | not null default `'{}'::jsonb` |
| `request_id` | `uuid` | nullable |
| `ip_address` | `inet` | nullable |
| `user_agent` | `text` | nullable |

`changed_fields` stores before/after values for state-coupled fields, for example:

```json
{
  "submitted_to_insurer_at": { "before": null, "after": "2026-06-06T10:00:00Z" },
  "insurer_submission_reference": { "before": null, "after": "AXA-12345" }
}
```

### LGPD Access Log

#### `health_access_log`

Logs access to Health Hub personal and health data. This is mandatory for Celina and useful for all users.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `event_type` | `health_access_event_type` | not null |
| `actor_user_id` | `uuid` | nullable references `app_users(id)` |
| `actor_roles` | `app_role[]` | not null default `'{}'::app_role[]` |
| `patient_id` | `uuid` | nullable references `health_family_members(id)` |
| `claim_id` | `uuid` | nullable references `reimbursement_claims(id)` |
| `entity_table` | `text` | nullable |
| `entity_id` | `uuid` | nullable |
| `action` | `text` | not null |
| `route` | `text` | nullable |
| `request_id` | `uuid` | nullable |
| `ip_address` | `inet` | nullable |
| `user_agent` | `text` | nullable |
| `metadata` | `jsonb` | not null default `'{}'::jsonb` |
| `occurred_at` | `timestamptz` | not null default `now()` |

Recommended indexes:

- `health_access_log(actor_user_id, occurred_at desc)`
- `health_access_log(patient_id, occurred_at desc)`
- `health_access_log(claim_id, occurred_at desc)`

### Notifications

#### `health_notifications`

One row per recipient per channel.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `event_type` | `health_notification_event_type` | not null |
| `recipient_user_id` | `uuid` | not null references `app_users(id)` on delete cascade |
| `claim_id` | `uuid` | nullable references `reimbursement_claims(id)` on delete cascade |
| `patient_id` | `uuid` | nullable references `health_family_members(id)` |
| `channel` | `health_notification_channel` | not null |
| `status` | `health_notification_status` | not null default `'pending'` |
| `title` | `text` | not null |
| `body` | `text` | not null |
| `payload` | `jsonb` | not null default `'{}'::jsonb` |
| `dedupe_key` | `text` | not null unique |
| `scheduled_for` | `timestamptz` | not null default `now()` |
| `queued_at` | `timestamptz` | nullable |
| `sent_at` | `timestamptz` | nullable |
| `read_at` | `timestamptz` | nullable |
| `failed_at` | `timestamptz` | nullable |
| `failure_reason` | `text` | nullable |
| `created_at` | `timestamptz` | not null default `now()` |

Notification triggers:

| Trigger | Recipients | Channels |
|---|---|---|
| Claim enters `needs_documents` | Mickael; Ayelet if scoped to patient | `in_app`, `email` |
| Claim enters `ready_to_submit` | Mickael; Celina if assigned to patient | `in_app`, `email` |
| Filing deadline is 30 days away and claim not submitted | Mickael; Ayelet if scoped; Celina if assigned and claim is ready | `in_app`, `email` |
| Filing deadline has expired before submission | Mickael; Ayelet if scoped | `in_app`, `email` |
| Claim enters `submitted_to_insurer` | Mickael; Ayelet if scoped | `in_app`, `email` |
| Claim enters `insurer_follow_up` | Mickael; Celina if assigned; Ayelet only when patient input is needed | `in_app`, `email` |
| Claim enters `approved` | Mickael; Celina if assigned | `in_app`, `email` |
| Claim enters `rejected` | Mickael; Ayelet if scoped; Celina if assigned | `in_app`, `email` |
| Claim enters `reimbursed_received` | Mickael; Ayelet if scoped, without bank account details | `in_app`, `email` |

### Email Send Log

#### `health_email_send_log`

Records each outbound Health Hub email attempt, including login challenge emails and notification emails.

| Column | Type | Constraints / notes |
|---|---|---|
| `id` | `uuid` | primary key default `gen_random_uuid()` |
| `notification_id` | `uuid` | nullable references `health_notifications(id)` on delete set null |
| `login_challenge_id` | `uuid` | nullable references `app_login_challenges(id)` on delete set null |
| `claim_id` | `uuid` | nullable references `reimbursement_claims(id)` on delete set null |
| `patient_id` | `uuid` | nullable references `health_family_members(id)` on delete set null |
| `recipient_user_id` | `uuid` | nullable references `app_users(id)` on delete set null |
| `recipient_email` | `citext` | not null |
| `template_key` | `text` | not null |
| `provider` | `text` | not null |
| `provider_message_id` | `text` | nullable |
| `subject` | `text` | not null |
| `status` | `health_email_status` | not null default `'queued'` |
| `payload` | `jsonb` | not null default `'{}'::jsonb` |
| `queued_at` | `timestamptz` | not null default `now()` |
| `sent_at` | `timestamptz` | nullable |
| `failed_at` | `timestamptz` | nullable |
| `error_message` | `text` | nullable |

## 3. Claim Lifecycle State Machine

### States

- `draft`: claim exists but assembly is incomplete or not yet evaluated.
- `needs_documents`: claim is missing required NF, payment, prescription, patient, policy, amount, or deadline data.
- `ready_to_submit`: all required assembly data is accepted and the filing deadline has not expired.
- `submitted_to_insurer`: claim has been sent/filed to the insurer.
- `insurer_follow_up`: insurer requested more information or an operational follow-up is pending.
- `approved`: insurer approved the claim but reimbursement money has not yet been recorded.
- `reimbursed_received`: at least one EUR reimbursement receipt has been confirmed.
- `rejected`: insurer denied the claim.
- `cancelled`: claim was intentionally abandoned before final processing.
- `closed`: final archived state after reimbursement, rejection, or cancellation is complete.

### Transition Rules

| From | To | Who can trigger | Required checks |
|---|---|---|---|
| none | `draft` | `health_admin`, `health_member`, system import | Actor can access patient, if patient is set |
| `draft` | `needs_documents` | system, `health_admin`, `health_member` | Ready computation is false |
| `needs_documents` | `draft` | `health_admin` | Manual reset reason required |
| `draft` | `ready_to_submit` | system, `health_admin` | Ready computation is true |
| `needs_documents` | `ready_to_submit` | system, `health_admin` | Ready computation is true |
| `ready_to_submit` | `submitted_to_insurer` | `health_admin`, scoped `health_secretary` | Submission timestamp and submission channel/reference captured |
| `submitted_to_insurer` | `insurer_follow_up` | `health_admin`, scoped `health_secretary` | Follow-up reason required |
| `insurer_follow_up` | `submitted_to_insurer` | `health_admin`, scoped `health_secretary` | Supplemental response sent and logged |
| `submitted_to_insurer` | `approved` | `health_admin`, scoped `health_secretary` | Approval date required; approved EUR amount optional |
| `insurer_follow_up` | `approved` | `health_admin`, scoped `health_secretary` | Approval date required; approved EUR amount optional |
| `submitted_to_insurer` | `rejected` | `health_admin`, scoped `health_secretary` | Rejection reason required |
| `insurer_follow_up` | `rejected` | `health_admin`, scoped `health_secretary` | Rejection reason required |
| `approved` | `reimbursed_received` | `health_admin`, scoped `health_secretary` | At least one `claim_reimbursement_receipts` row exists |
| `submitted_to_insurer` | `reimbursed_received` | `health_admin`, scoped `health_secretary` | Receipt row exists; used when insurer pays without explicit approval notice |
| `reimbursed_received` | `closed` | `health_admin` | Receipt reconciliation reviewed |
| `rejected` | `closed` | `health_admin` | Final denial accepted or appeal not pursued |
| `draft` | `cancelled` | `health_admin`, owning/scoped `health_member` | Cancel reason required |
| `needs_documents` | `cancelled` | `health_admin`, owning/scoped `health_member` | Cancel reason required |
| `ready_to_submit` | `cancelled` | `health_admin` | Cancel reason required |
| `submitted_to_insurer` | `cancelled` | `health_admin` | Cancel reason required |
| `insurer_follow_up` | `cancelled` | `health_admin` | Cancel reason required |
| `approved` | `cancelled` | `health_admin` | Cancel reason required |
| `cancelled` | `closed` | `health_admin` | Final review complete |

No outgoing transitions are allowed from `closed`.

Every transition must:

- Update `reimbursement_claims.claim_state`.
- Update `state_updated_at` and `state_updated_by`.
- Insert a row in `health_claim_state_audit`.
- Insert relevant `health_notifications` rows.
- Insert `health_access_log` when the actor is a person.

## 4. Deadline Computation

Deadline fields are snapshots on `reimbursement_claims` because policy terms can change over time.

Computation:

1. Load `insurance_policies.claim_filing_window_anchor`.
2. If anchor is `service_date`, set `deadline_anchor_date = nota_fiscais.service_date`.
3. If anchor is `payment_date`, set `deadline_anchor_date = nota_fiscal_payments.paid_on`.
4. Set `service_date = nota_fiscais.service_date`.
5. Set `filing_deadline_date = deadline_anchor_date + claim_filing_window_months months + claim_filing_grace_days days`.
6. If `deadline_override_date` is set, the effective deadline is `deadline_override_date`; otherwise it is `filing_deadline_date`.

Deadline status is computed in queries, not stored:

- `expired`: `current_date > effective_deadline_date`
- `due_soon`: `current_date <= effective_deadline_date and current_date >= effective_deadline_date - interval '30 days'`
- `ok`: all other non-expired deadlines
- `unknown`: no effective deadline because required date or policy is missing

Ready-to-submit requires deadline status to be `ok` or `due_soon`, never `expired` or `unknown`.

## 5. Three-Part Assembly Mapping

Each reimbursement claim is assembled from exactly one primary payment record, one primary NF, and zero or one primary prescription/document depending on policy requirements.

### Claim-to-Source Mapping

| Assembly part | Source table | Claim column | Required source fields |
|---|---|---|---|
| Payment record | `nota_fiscal_payments` | `reimbursement_claims.nota_fiscal_payment_id` | `amount_paid_brl`, `paid_on`, `nota_fiscal_id`, `review_status = 'accepted'` |
| Nota fiscal | `nota_fiscais` | `reimbursement_claims.nota_fiscal_id` | `service_description`, `service_date`, `patient_id`, `review_status = 'accepted'` |
| Prescription/doc | `medical_documents` | `reimbursement_claims.prescription_document_id` | `document_type = 'prescription'`, `document_date`, `patient_id`, `review_status = 'accepted'` |

Canonical claim values:

- `reimbursement_claims.patient_id` must match `nota_fiscais.patient_id` and `medical_documents.patient_id` when a prescription is required.
- `reimbursement_claims.insurance_policy_id` points to the policy that defines filing window and required documents.
- `reimbursement_claims.claimed_amount_brl = nota_fiscal_payments.amount_paid_brl`.
- `reimbursement_claims.service_date = nota_fiscais.service_date`.
- `reimbursement_claims.deadline_anchor_date` and `filing_deadline_date` are computed from the policy and source dates.
- `nota_fiscais.service_description` is the insurer-facing service description.

### Ready-to-Submit Computation

`ready_to_submit` is a deterministic computation. The app may store `ready_to_submit_at`, but readiness itself should be recomputed from source data before transition.

A claim is ready when all of the following are true:

Claim-level fields:

- `reimbursement_claims.patient_id is not null`
- `reimbursement_claims.insurance_policy_id is not null`
- `reimbursement_claims.nota_fiscal_id is not null`
- `reimbursement_claims.nota_fiscal_payment_id is not null`
- `reimbursement_claims.claimed_amount_brl is not null`
- `reimbursement_claims.claimed_amount_brl > 0`
- `reimbursement_claims.service_date is not null`
- `reimbursement_claims.filing_deadline_date is not null` or `deadline_override_date is not null`
- Effective deadline is not expired
- `claim_state in ('draft', 'needs_documents', 'ready_to_submit')`

Policy fields:

- `insurance_policies.requires_nota_fiscal = true` implies NF checks must pass.
- `insurance_policies.requires_payment_proof = true` implies payment checks must pass.
- `insurance_policies.requires_prescription = true` implies `prescription_document_id is not null` and prescription checks must pass.

NF checks:

- `nota_fiscais.id = reimbursement_claims.nota_fiscal_id`
- `nota_fiscais.patient_id = reimbursement_claims.patient_id`
- `nota_fiscais.service_description is not null`
- `length(trim(nota_fiscais.service_description)) > 0`
- `nota_fiscais.service_date is not null`
- `nota_fiscais.currency = 'BRL'`
- `nota_fiscais.review_status = 'accepted'`

Payment checks:

- `nota_fiscal_payments.id = reimbursement_claims.nota_fiscal_payment_id`
- `nota_fiscal_payments.nota_fiscal_id = reimbursement_claims.nota_fiscal_id`
- `nota_fiscal_payments.amount_paid_brl is not null`
- `nota_fiscal_payments.amount_paid_brl > 0`
- `nota_fiscal_payments.paid_on is not null`
- `nota_fiscal_payments.review_status = 'accepted'`
- `abs(nota_fiscal_payments.amount_paid_brl - reimbursement_claims.claimed_amount_brl) <= 0.01`

Prescription checks, when required:

- `medical_documents.id = reimbursement_claims.prescription_document_id`
- `medical_documents.patient_id = reimbursement_claims.patient_id`
- `medical_documents.document_type = 'prescription'`
- `medical_documents.document_date is not null`
- `medical_documents.review_status = 'accepted'`
- `medical_documents.prescription_valid_from is null or prescription_valid_from <= nota_fiscais.service_date`
- `medical_documents.prescription_valid_until is null or prescription_valid_until >= nota_fiscais.service_date`

When the computation changes from false to true:

- Transition `draft` or `needs_documents` to `ready_to_submit`.
- Set `ready_to_submit_at = now()` if it is null.
- Notify Mickael and assigned Celina.

When the computation changes from true to false before submission:

- Transition `ready_to_submit` to `needs_documents`.
- Clear `ready_to_submit_at` only if the prior readiness was never acted on.
- Notify Mickael and Ayelet if patient-scoped.

## 6. Implementation Notes for Round 2+

- The first migration should create enum types, auth/session tables, patient registry, access log, notification/email tables, bank account table, receipt table, and supplemental document mapping table.
- Then add the listed columns to existing Health Hub tables.
- Backfill `app_users` for Mickael, Ayelet, and Celina.
- Backfill `health_user_patient_access` for Mickael/Ayelet and only the explicitly approved patients for Celina.
- Backfill `claim_state` from any existing claim status if one exists; otherwise default all existing incomplete records to `needs_documents`.
- Implement `getHealthHubActor()` separately from `getRole()` and leave finance/admin auth unchanged.
- Implement readiness as a shared server function used by create/update actions, transition actions, and notification jobs.
