# Health Hub Round 2 Critique

Round 2 position: Round 1 established the right high-level direction, but it left too many operational details implicit for a medical-reimbursement workflow. The missing details are not cosmetic. They affect duplicate submissions, patient safety, private document access, Gmail send reliability, and whether a claim can be assembled without human guesswork.

This critique makes concrete implementation decisions for Round 3. Items labeled `CRITIQUE` are explicit disagreements with, or corrections to, Round 1.

## 1. NF and Recibo Ingestion

### CRITIQUE: Round 1 treats ingestion as a source-specific import problem, not as a document intake pipeline

The system needs a single intake model for all incoming medical documents, regardless of whether they came from a watched PDF folder, the Sao Paulo portal, Gmail, manual upload, scanner upload, or a weekly batch. Otherwise, every source will reimplement deduplication, patient mapping, storage, OCR, and claim-readiness logic differently.

### Required intake flows

Implement these as three UI and job entry points into the same pipeline:

1. `bulk_drop`: many PDFs or images uploaded together, usually from a folder export or scanner batch.
2. `single_upload`: one NF, recibo, prescription, or supporting document uploaded from the claim screen.
3. `weekly_batch`: scheduled importer that collects new source files from configured folders, Gmail attachments, or SP portal exports.

All three flows create an `health_ingestion_sessions` row:

- `id`
- `source_type`: `bulk_drop`, `single_upload`, `weekly_batch`, `gmail_attachment`, `sp_portal`, `scanner`
- `created_by`
- `status`: `pending`, `processing`, `processed`, `processed_with_errors`, `failed`
- `started_at`, `finished_at`
- `error_detail`

Each uploaded or discovered file creates `health_ingestion_files`:

- `id`
- `ingestion_session_id`
- `source_type`
- `original_file_name`
- `storage_bucket`
- `storage_path`
- `sha256`
- `mime_type`
- `byte_size`
- `document_type_guess`: `nota_fiscal`, `recibo`, `prescription`, `supporting_document`, `unknown`
- `processing_status`
- `parsed_document_id`
- `parsed_document_table`
- `dedup_status`: `new`, `duplicate_file`, `duplicate_document`, `possible_duplicate`, `needs_review`
- `error_detail`
- `created_at`

### Storage path and file-name uniqueness for newly uploaded or scanned files

New files must be saved before parsing, because OCR and extraction may fail and the original still needs to be reviewable.

Use private Supabase Storage, not local disk:

- Bucket: `health-documents`
- Raw intake path: `households/{household_id}/ingestion/{session_id}/{file_uuid}-{safe_original_name}`
- Parsed NF path after linkage: `households/{household_id}/patients/{patient_id_or_unmatched}/nota-fiscais/{nota_fiscal_id}/original.pdf`
- Parsed recibo path after linkage: `households/{household_id}/patients/{patient_id_or_unmatched}/recibos/{recibo_id}/original.{ext}`
- Prescriptions: `households/{household_id}/patients/{patient_id_or_unmatched}/prescriptions/{prescription_id}/original.{ext}`
- Generated summaries: bucket `health-generated`, path `households/{household_id}/claims/{claim_id}/summary-{submission_version}.pdf`

File names are never trusted for uniqueness. The user-visible original name is metadata only. The storage path uses a UUID prefix and the content hash is stored in `health_ingestion_files.sha256`.

Pipeline for any newly-uploaded or scanned NF:

1. Receive file through authenticated upload or server action.
2. Sanitize the original file name for display only.
3. Compute `sha256`, `mime_type`, and `byte_size`.
4. Upload original bytes to `health-documents` under the raw intake path.
5. Insert `health_ingestion_files`.
6. If the same `sha256` already exists, mark `duplicate_file` and link to the prior file unless the user explicitly asks to reprocess.
7. Run text extraction. For text PDFs, extract embedded text first. For scanned PDFs or images, run OCR through the existing Vertex/Gemini path.
8. Classify document type: NF, recibo, prescription, support, or unknown.
9. Parse structured fields.
10. Deduplicate against existing document rows.
11. Map patient.
12. Insert or update `nota_fiscais`, `health_recibos`, or the relevant supporting-document table.
13. Move or copy the canonical file reference from raw intake to the parsed document path, keeping the original raw file row for audit.
14. Recompute claim readiness for affected patient/date/provider/amount.

### NF deduplication

`nota_fiscais` needs two levels of uniqueness: file-level and document-level.

File-level duplicate:

- Same `sha256`
- Same `byte_size`
- Same canonical storage asset, if already uploaded

Document-level duplicate natural key:

Preferred key when present:

- `nf_access_key` or verification/access code, normalized

Fallback key when access key is missing:

- `issuer_document_norm`: CNPJ or CPF stripped to digits
- `municipality_code` or `city_registration`, if present
- `nf_number_norm`
- `nf_series_norm`, nullable but normalized
- `issued_on`
- `total_amount_cents`
- `patient_name_norm` or `patient_id`, if already mapped

Recommended indexes:

- Unique partial index on `nota_fiscais(nf_access_key)` where `nf_access_key is not null`.
- Unique partial index on `(issuer_document_norm, municipality_code, nf_number_norm, coalesce(nf_series_norm, ''), issued_on, total_amount_cents, coalesce(patient_id::text, patient_name_norm))` where `nf_access_key is null and dedup_confirmed = true`.

Do not rely on file name, upload date, or source folder as part of the natural key. They are source metadata, not document identity.

### Medical auto-categorization

`nota_fiscais` should not become medical merely because a family member name appears on it. The medical flag should be confidence-based and explainable.

Add or use:

- `nota_fiscais.is_medical boolean`
- `nota_fiscais.medical_confidence numeric`
- `nota_fiscais.medical_classification_reason jsonb`
- `nota_fiscais.medical_review_status`: `auto_medical`, `auto_non_medical`, `needs_review`, `manually_medical`, `manually_non_medical`

Signals that increase medical confidence:

- Issuer matches `health_providers` by CNPJ, CPF, normalized name, or known alias.
- Issuer document appears in a provider allowlist.
- NF municipal service code, CNAE, or activity description maps to health services.
- Service description contains health terms such as `consulta`, `terapia`, `psicologia`, `fono`, `exame`, `laboratorio`, `clinica`, `medico`, `hospital`, `dentista`, `ortodontia`, `nutricionista`, `fisioterapia`, or specialty names.
- Professional registration appears in text: CRM, CRO, CRP, CREFITO, CRFa, CRN, COREN.
- The recipient or patient name matches a known family member with high confidence.
- The document was imported from a health-specific source folder or a claim upload screen.
- Gemini extraction returns a structured medical-service classification with cited text spans.

Signals that reduce confidence:

- Issuer is known non-medical merchant.
- Service description maps to school, retail, travel, food, household, or general services.
- No provider, professional-registration, service-code, or medical text signal is present.

Suggested thresholds:

- `medical_confidence >= 0.85`: auto medical.
- `0.55 <= medical_confidence < 0.85`: needs review.
- `< 0.55`: auto non-medical, unless uploaded directly into a health claim, in which case needs review.

### Recibo ingestion is not NF ingestion

CRITIQUE: Round 1 appears to treat "medical document" as mostly NF-shaped. Recibos are first-class inputs and need a separate model.

A recibo often lacks:

- CNPJ issuer
- Municipal NF number
- NF access key
- Formal service code
- Portal verification code

It may instead contain:

- Provider person name
- Provider CPF or professional registration
- Patient name
- Service date or date range
- Receipt date
- Amount paid
- Payment method
- Signature or stamp
- Optional receipt number
- Specialty or service description

Create `health_recibos`:

- `id`
- `household_id`
- `provider_id`, nullable until matched
- `provider_name_raw`
- `provider_document_norm`, nullable
- `provider_registration_raw`, nullable
- `patient_id`, nullable until mapped
- `patient_name_raw`
- `service_on`
- `service_period_start`, nullable
- `service_period_end`, nullable
- `receipt_on`
- `receipt_number_raw`, nullable
- `amount_cents`
- `currency`
- `service_description`
- `payment_method`, nullable
- `storage_asset_id`
- `source_ingestion_file_id`
- `dedup_status`
- `created_at`, `updated_at`

Recibo natural key:

- Preferred: `(provider_document_norm, receipt_number_raw, receipt_on, amount_cents)` when provider document and receipt number exist.
- Fallback: `(provider_name_norm, patient_id or patient_name_norm, service_on, amount_cents, service_description_norm)`.
- Always also check file `sha256`.

A recibo can satisfy a claim's proof-of-payment requirement, but it should not create a `nota_fiscais` row unless the document is actually an NF.

## 2. Gmail Send Integration

### CRITIQUE: Round 1 under-specifies the send side and assumes OAuth read access is enough

The app already has Gmail OAuth read-only code under `lib/gmail`. Sending requires a scope upgrade and a re-consent path for any existing connected account.

Minimum send scope:

- `https://www.googleapis.com/auth/gmail.send`

Do not request `gmail.modify` unless the app will also label, archive, or mark source messages after processing. If weekly Gmail ingestion needs to apply a "processed" label, then add:

- `https://www.googleapis.com/auth/gmail.modify`

Round 3 should implement `gmail.send` first. Add `gmail.modify` only if there is a concrete label-management requirement.

### Email assembly

Generate a single email package per claim submission version. The email should include:

- NF PDF or recibo PDF/image, depending on claim document type.
- Prescription image/PDF when required by policy or service type.
- Human-readable summary sheet as a generated PDF attachment.

The summary sheet must include:

- Claim ID
- Submission version
- Patient full name
- Patient relationship or family member label
- Service category
- Provider name
- Provider document, if present
- Provider professional registration, if present
- NF number/access key or recibo number
- Issue date
- Service date or service period
- Amount paid
- Requested reimbursement amount
- Eligibility status and policy version used, or `manual bypass pending final policy`
- Prescription status: attached, not required, missing
- Document checklist
- Notes for Celina
- Household contact email
- Generated timestamp

Keep the summary factual. Do not include internal extraction confidence scores unless a human needs review.

### Auto-send trigger conditions

Auto-send fires only when a claim transitions into:

- `ready_to_send`

Required conditions before entering `ready_to_send`:

- `patient_id is not null`
- The primary document exists: NF or recibo.
- Required supporting documents are attached, including prescription when required or manually marked not required.
- `eligibility_confirmed = true`
- No unresolved duplicate conflict.
- No unresolved low-confidence medical classification.
- No unresolved low-confidence patient mapping.
- `auto_email_enabled = true`
- No existing successful send for the same claim and submission version.

The send worker then moves the claim through:

- `ready_to_send -> sending_to_celina -> sent_to_celina`

If sending fails:

- Retryable failure: `sending_to_celina -> send_retry_pending`
- Non-retryable failure: `sending_to_celina -> send_failed`
- Auth failure: `sending_to_celina -> gmail_reauth_required`

### Idempotency and double-send prevention

Gmail does not provide a reliable app-level idempotency key for `messages.send`. The database must be the source of truth.

Use a DB-backed outbox:

`health_email_outbox`:

- `id`
- `claim_id`
- `submission_version`
- `recipient_type`: `celina`
- `recipient_email`
- `idempotency_key`
- `status`: `pending`, `sending`, `sent`, `retry_pending`, `failed`, `auth_required`, `cancelled`
- `attempt_count`
- `last_attempt_at`
- `next_attempt_at`
- `gmail_message_id`
- `error_detail`
- `created_at`, `updated_at`

`idempotency_key` should be deterministic:

- `celina:{claim_id}:{submission_version}:{recipient_email_lower}`

Add a unique index:

- `unique(idempotency_key)`

On transition to `ready_to_send`, insert the outbox row in the same transaction that changes the claim state. If the unique insert conflicts, do not create another row. Page reloads, retries, and duplicate button clicks must all converge on the same outbox row.

The worker claims an outbox row with a row lock or atomic status update:

- Only one worker can move `pending` or `retry_pending` to `sending`.
- If the process dies while `sending`, a timeout job can requeue it after a conservative interval.
- Before retrying an uncertain timeout, search Gmail using existing read access for the generated RFC `Message-ID` if available. If the message exists, mark sent rather than sending again.

### Required send log

Create `health_email_send_log` as an append-only audit log. At minimum it must include the columns requested for Round 2:

- `claim_id`
- `triggered_by`
- `status`
- `gmail_message_id`
- `error_detail`
- `sent_at`

Recommended complete columns:

- `id`
- `claim_id`
- `outbox_id`
- `submission_version`
- `triggered_by`: user id, system job id, or `auto_transition`
- `status`: `queued`, `sending`, `sent`, `retryable_error`, `permanent_error`, `auth_error`, `cancelled`
- `gmail_message_id`
- `recipient_email`
- `attachment_manifest_hash`
- `error_detail`
- `attempt_number`
- `sent_at`
- `created_at`

The log is not the idempotency guard by itself. The unique outbox key is the guard.

### Retry and failure handling

Transient Gmail errors:

- Retry 429, 500, 502, 503, and 504 with exponential backoff plus jitter.
- Cap retry attempts, for example 8 attempts over roughly 24 hours.
- Keep the claim in `send_retry_pending` while retries remain.

Attachment too large:

- Gmail messages have a practical total attachment size limit around 25 MB.
- If total generated MIME size exceeds 20 MB, do not attempt send with attachments.
- Send the summary sheet plus time-limited signed links to documents.
- Log `attachment_strategy = signed_links`.

OAuth token expired:

- Refresh automatically using the stored refresh token.
- If refresh fails because access was revoked or scopes are insufficient, mark outbox `auth_required`, claim `gmail_reauth_required`, and surface a reconnect action.

Scope mismatch:

- If the connected account lacks `gmail.send`, block auto-send and mark `gmail_reauth_required`.
- Do not silently fall back to manual download unless the UI clearly shows that the email was not sent.

Partial send uncertainty:

- If the Gmail API request times out after upload, do not immediately retry blindly.
- Search for the RFC `Message-ID` using existing Gmail read access if available.
- If found, mark sent with the Gmail message id.
- If not found, retry according to backoff.

## 3. Supabase Storage Migration

### CRITIQUE: Local `private/` storage is incompatible with Vercel and unsafe for medical-document workflow

Documents currently saved to a local `private/` directory will disappear or become inaccessible on Vercel. They also cannot support reliable signed access, audit logging, or multi-device review. Move all health documents to private Supabase Storage.

### Bucket design

Use three private buckets:

1. `health-documents`: original uploaded PDFs, images, prescriptions, recibos, and NFs.
2. `health-generated`: generated summary sheets, assembled packets, thumbnails, and OCR text artifacts if stored as files.
3. `health-ingestion-staging`: temporary raw intake files before document classification, with lifecycle cleanup.

All buckets must be private. No public bucket for medical files.

Folder structure:

- `households/{household_id}/ingestion/{session_id}/{file_uuid}-{safe_original_name}`
- `households/{household_id}/patients/{patient_id}/nota-fiscais/{nota_fiscal_id}/original.pdf`
- `households/{household_id}/patients/{patient_id}/recibos/{recibo_id}/original.{ext}`
- `households/{household_id}/patients/{patient_id}/prescriptions/{prescription_id}/original.{ext}`
- `households/{household_id}/patients/unmatched/{document_id}/original.{ext}`
- `households/{household_id}/claims/{claim_id}/summary-{submission_version}.pdf`
- `households/{household_id}/claims/{claim_id}/packet-{submission_version}.zip`, only if packet export is needed

Create `health_document_assets`:

- `id`
- `household_id`
- `patient_id`, nullable
- `claim_id`, nullable
- `document_kind`: `nota_fiscal`, `recibo`, `prescription`, `summary`, `supporting`, `ocr_artifact`
- `bucket`
- `storage_path`
- `original_file_name`
- `sha256`
- `mime_type`
- `byte_size`
- `created_by`
- `created_at`
- `deleted_at`

Database rows should reference `health_document_assets.id`, not raw storage paths wherever possible.

### RLS policies

Storage RLS should be narrow and backed by metadata:

- Household users can read assets where `health_document_assets.household_id` is in their household membership.
- Household users can insert assets only under their household prefix.
- Service-role jobs can read/write all health buckets for ingestion, OCR, summary generation, and email assembly.
- Celina should not receive broad direct Storage RLS access by default. She should receive app-issued signed links or email attachments.
- Deleted assets with `deleted_at is not null` are not accessible to normal users.

Because Supabase Storage policies operate on object paths, enforce both:

- Path prefix starts with `households/{household_id}/`.
- A corresponding `health_document_assets` row exists and the actor is allowed to access that household.

### Signed URL access for Celina

Use an application-controlled signed-link table instead of exposing long-lived Supabase signed URLs directly.

`health_document_share_links`:

- `id`
- `claim_id`
- `asset_id`
- `recipient_type`: `celina`
- `recipient_email`
- `token_hash`
- `expires_at`
- `revoked_at`
- `created_by`
- `created_at`
- `last_accessed_at`
- `access_count`

Default expiry:

- 7 days for Celina claim-email links.
- 1 hour for links generated inside the authenticated app UI.
- The edge/API route should exchange a valid app token for a Supabase signed URL that expires in 60 seconds.

This gives revocation. Direct Supabase signed URLs cannot be revoked before expiry; the app-controlled token can be revoked by setting `revoked_at`.

Log every access in `health_document_access_log`:

- `id`
- `share_link_id`
- `asset_id`
- `claim_id`
- `recipient_type`
- `recipient_email`
- `accessed_at`
- `ip_address`
- `user_agent`
- `result`: `allowed`, `expired`, `revoked`, `not_found`

### Migration plan for existing local files

1. Freeze new local writes to `private/` for health documents.
2. Inventory existing local health files under `private/` and map each file to its owning row, if any.
3. Compute `sha256`, MIME type, and byte size for each file.
4. Insert `health_document_assets` rows with `migration_source_path`.
5. Upload each file to the correct Supabase bucket and path.
6. Update `nota_fiscais`, `health_recibos`, prescriptions, and claim document references to `health_document_assets.id`.
7. Verify count, byte size, and hash parity between local and Supabase copies.
8. Run a dry-run claim assembly against migrated documents.
9. Keep local files as read-only backup for 30 days.
10. Delete local health files only after manual sign-off.

## 4. Patient Mapping

### CRITIQUE: Free-text `patient_name` is not sufficient for a reimbursement system

`nota_fiscais.patient_name` values such as `Mila Esther Malka` and `Lavi Haim Malka` need to map to `health_family_members.patient_id`. The original text should remain for audit, but claim readiness must depend on a stable patient id.

### Mapping model

Use `health_family_members.patient_id` as canonical.

Add `health_patient_aliases`:

- `id`
- `patient_id`
- `alias_raw`
- `alias_norm`
- `source`: `manual`, `backfill`, `ocr`, `import`
- `confidence`
- `created_by`
- `created_at`

Normalize names by:

- Lowercasing.
- Removing accents.
- Removing punctuation.
- Collapsing whitespace.
- Removing labels like `paciente`, `beneficiario`, `nome`.
- Keeping meaningful middle names.
- Optionally stripping CPF fragments when mixed into a name field.

Examples:

- `Mila Esther Malka` -> `mila esther malka`
- `MILA E. MALKA` -> `mila e malka`
- `Lavi Haim Malka` -> `lavi haim malka`

### Backfill approach

For every `nota_fiscais` row with `patient_name` and null `patient_id`:

1. Normalize `patient_name` into `patient_name_norm`.
2. Exact-match against `health_patient_aliases.alias_norm`.
3. Exact-match against normalized `health_family_members.full_name`.
4. Fuzzy-match with token-set ratio plus Jaro-Winkler or PostgreSQL trigram similarity.
5. Boost score when the document includes a CPF or birth date that matches the family member, if those fields exist.
6. Penalize score when two family members share first or last tokens and the middle-name signal is missing.
7. Store the proposed match in `health_patient_match_candidates`.

`health_patient_match_candidates`:

- `id`
- `source_table`: `nota_fiscais`, `health_recibos`
- `source_id`
- `candidate_patient_id`
- `score`
- `signals jsonb`
- `decision`: `auto_accepted`, `manual_accepted`, `manual_rejected`, `unmatched`
- `reviewed_by`
- `reviewed_at`
- `created_at`

Thresholds:

- `score >= 0.92`: auto-accept.
- `0.80 <= score < 0.92`: queue for review.
- `< 0.80`: leave unmatched.

For the known examples, add manual aliases before running backfill:

- `Mila Esther Malka`
- Any observed short forms for Mila.
- `Lavi Haim Malka`
- Any observed short forms for Lavi.

### Review and unmatched behavior

Low-confidence matches go to a review screen showing:

- Original document preview.
- Extracted patient name.
- Candidate family members with scores and matched tokens.
- Provider and service date.
- Amount.

Reviewer actions:

- Accept candidate.
- Pick another family member.
- Mark as not a family health document.
- Leave unmatched.
- Create a new alias for future auto-matching.

Unmatched rows:

- Keep `patient_id = null`.
- Set claim lifecycle to `needs_patient_mapping`.
- Exclude from auto-email.
- Exclude from patient reimbursement totals unless explicitly included in an unmatched report.
- Remain searchable by original `patient_name`.

Never overwrite the raw patient name. Store both:

- `patient_name_raw`
- `patient_name_norm`
- `patient_id`

## 5. Eligibility Engine Track

### CRITIQUE: Eligibility is important, but Round 1 must not let a missing policy document block the main workflow

The policy-driven decision "reimbursable and within limit" should be designed now but stubbed until the policy document is available. Claim assembly needs one simple gate, not a dependency on a finished policy DSL.

### Claim integration

Add these fields to `health_claims`:

- `eligibility_confirmed boolean not null default false`
- `eligibility_status`: `not_evaluated`, `assumed_eligible`, `confirmed_eligible`, `partially_eligible`, `ineligible`, `needs_review`
- `eligibility_result_id`, nullable
- `eligibility_confirmed_by`, nullable
- `eligibility_confirmed_at`, nullable
- `eligibility_bypass_reason`, nullable

The exact ready/assembly gate is:

- `health_claims.eligibility_confirmed = true`

Claim assembly does not need to know whether the value came from the future policy engine or a temporary manual bypass. It only checks the flag and shows the supporting status.

### Stub and bypass design

Until the policy document is available:

- Default all new claims to `eligibility_status = not_evaluated` and `eligibility_confirmed = false`.
- Provide a manual action: `Assume eligible for current process`.
- That action creates an eligibility result with `decision = assumed_eligible`, `policy_version = stub-2026-06`, and an explicit reason.
- It sets `eligibility_confirmed = true`.
- It must be logged with actor and timestamp.

This keeps the main flow moving while making the assumption visible and reversible.

### Eligibility result storage and versioning

Create `health_policy_versions`:

- `id`
- `policy_name`
- `version_label`
- `effective_from`
- `effective_to`
- `source_document_asset_id`
- `policy_hash`
- `status`: `draft`, `active`, `retired`
- `created_at`

Create `health_eligibility_results`:

- `id`
- `claim_id`
- `policy_version_id`, nullable for stub
- `policy_version_label`
- `policy_hash`, nullable for stub
- `input_snapshot jsonb`
- `decision`: `eligible`, `partially_eligible`, `ineligible`, `needs_review`, `assumed_eligible`
- `eligible_amount_cents`
- `limit_amount_cents`
- `remaining_limit_cents`
- `reasons jsonb`
- `evaluated_by`: `policy_engine`, `manual_user`, `stub_bypass`
- `evaluated_at`
- `supersedes_result_id`, nullable

When policy changes, do not mutate old results. Insert a new result with a new policy version and link it through `supersedes_result_id`. Claims sent under old policy versions remain auditable.

### Plug-in point for future policy engine

The future engine should accept an input snapshot, not live mutable rows:

- Patient id and age/date of birth if needed.
- Service date.
- Provider.
- Service category.
- NF/recibo amount.
- Prior reimbursements in the policy period.
- Prescription presence.
- Manual overrides.

It returns a versioned `health_eligibility_results` row and updates `health_claims.eligibility_*`. The claim readiness recomputation is then triggered.

## 6. Auto-Email Trigger and Lifecycle Interaction

### CRITIQUE: Round 1's lifecycle needs a single send trigger and hard idempotency guard

Do not send email from multiple "ready-ish" states. Do not send directly from page render or client-side effects. Send only from the server-side transition into `ready_to_send`, via the outbox.

### Exact trigger state

The only lifecycle transition that creates the Celina email outbox row is:

- Any pre-send state -> `ready_to_send`

The outbox worker then controls:

- `ready_to_send -> sending_to_celina`
- `sending_to_celina -> sent_to_celina`
- `sending_to_celina -> send_retry_pending`
- `sending_to_celina -> send_failed`
- `sending_to_celina -> gmail_reauth_required`

If Round 1 has a ten-state lifecycle with different labels, map them to this rule rather than adding another trigger. The trigger state should be named `ready_to_send` or the Round 1 equivalent should be renamed to it.

### DB-level idempotency guard

Use both:

- `health_email_outbox.idempotency_key unique`
- `health_claims.last_sent_submission_version`

On document or amount changes before send:

- Increment `health_claims.submission_version`.
- Recompute the outbox idempotency key.

After send:

- Set `health_claims.last_sent_submission_version = submission_version`.
- Set `health_claims.sent_to_celina_at`.
- Store the Gmail message id on the outbox row and send log.

Before creating an outbox row, check:

- No existing `sent` outbox row for `(claim_id, submission_version, celina)`.
- No existing `pending`, `sending`, or `retry_pending` outbox row for the same idempotency key.

The unique constraint is mandatory because application checks alone are race-prone.

### Allowed and blocked transitions after send

After `sent_to_celina`, block transitions back to:

- `needs_patient_mapping`
- `needs_documents`
- `needs_medical_review`
- `eligibility_pending`
- `ready_to_send`
- `sending_to_celina`

Do not allow silent edits to:

- Patient id
- Provider
- Amount
- NF/recibo identity
- Attached primary document
- Prescription required/attached status
- Eligibility result

Allowed after send:

- `sent_to_celina -> reimbursed`
- `sent_to_celina -> rejected`
- `sent_to_celina -> follow_up_needed`
- `sent_to_celina -> closed`
- `follow_up_needed -> sent_to_celina` only when no new submission is needed.

If a substantive correction is needed after send:

1. Create a new `submission_version`.
2. Mark the claim `revision_needed`.
3. Require a human action to approve resend.
4. Generate a new summary sheet with `Correction / replacement for submission version N`.
5. Use a new idempotency key for the new version.

This avoids both accidental double-send and silent divergence between what Celina received and what the app now shows.

## 7. Over-Engineering Check

### CRITIQUE: Round 1 is too heavy in several places for a family app with about three users

The app needs reliable auditability and privacy, but it does not need enterprise-grade identity and access complexity everywhere. Simpler choices will reduce bugs and implementation time.

### Passwordless email-code login vs shared-but-named secrets

CRITIQUE: Passwordless email-code login for every external participant is likely overkill for this use case.

Problems with passwordless email-code login:

- Email deliverability becomes part of login reliability.
- Supabase auth configuration and redirect handling add implementation surface.
- Existing users may need account linking.
- It does not by itself solve "who clicked this link" if links are forwarded.

Simpler alternative:

- Household owner uses the existing app auth.
- External helper access uses named, rotatable secrets:
  - `Celina`
  - optional future helper names
- Each secret is long, random, revocable, and stored hashed.
- The UI and logs always record the actor label tied to the secret.
- Secrets expire or can be rotated manually.

This is not an anonymous shared password. It is "shared-but-named" in the sense that each trusted person has a named access secret and every action is logged against that name.

If medical privacy requirements become stricter later, migrate Celina to full Supabase auth. Do not start there unless she needs a persistent portal account.

### Per-patient scopes for Celina vs all-access-but-logged

CRITIQUE: Per-patient access scopes for Celina are too fine-grained for a trusted family reimbursement helper unless there is a specific reason she should see one child but not another.

Simpler alternative:

- Celina can access all documents included in claims sent to her.
- Every access is logged.
- Links are time-limited and revocable.
- The summary sheet clearly shows patient name so accidental misrouting can be caught.

Do not build per-patient RBAC until there are multiple external helpers with different trust boundaries.

### Other over-specced areas

Lifecycle:

- A ten-state lifecycle may be useful, but avoid adding parallel booleans that conflict with it.
- Use lifecycle state for workflow position and explicit flags for gates: `eligibility_confirmed`, `auto_email_enabled`, `has_required_documents`.
- Do not create extra states for every UI message.

Eligibility engine:

- Do not build a policy DSL before the policy document exists.
- Start with versioned manual/stub results and a small rules function later.

OCR and AI:

- Do not require perfect extraction before allowing manual correction.
- Store extraction confidence and text spans, but let users fix fields.

Gmail:

- Do not request `gmail.modify` unless label management is implemented.
- Do not implement a separate email service. A DB outbox plus scheduled worker is enough.

Storage:

- Do not build per-document encryption keys unless there is a clear compliance requirement.
- Private Supabase buckets, RLS, signed links, and access logs are sufficient for this family workflow.

Claim package:

- Do not generate ZIP packets by default.
- Email attachments plus fallback signed links are enough.

Audit:

- Append-only logs for sends and document access are necessary.
- Full event sourcing for every field change is probably too much. Use normal audit fields plus targeted history for sent submissions and eligibility results.

## Round 3 Implementation Priorities

1. Move document storage to Supabase private buckets and introduce `health_document_assets`.
2. Add ingestion sessions/files and the unified intake pipeline.
3. Backfill patient mapping with aliases and review queue.
4. Add claim readiness gates, including `eligibility_confirmed`.
5. Add Gmail `gmail.send` re-consent and DB outbox.
6. Add generated summary sheet.
7. Add Celina signed-link access logging for oversized emails or portal review.

## OPEN QUESTIONS

1. What exact email address should Celina receive submissions at?
2. Should Celina normally receive attachments, signed links, or attachments with signed-link fallback only when size is too large?
3. Is auto-send enabled by default once a claim is `ready_to_send`, or should the first release require a manual "send to Celina" approval click?
4. Which Gmail account is the sender, and who will re-consent with the new `gmail.send` scope?
5. What are the canonical `health_family_members` rows and aliases for each patient, including nicknames and common NF spellings?
6. Are there known medical provider CNPJs, CPFs, names, or specialties that should seed the provider allowlist?
7. Which document types require a prescription before reimbursement?
8. What is the actual reimbursement policy document, effective date, annual/monthly limit, and category taxonomy?
9. Is a manual eligibility bypass acceptable for Round 3 while the policy document is pending?
10. What local `private/` subdirectories currently contain health documents that must be migrated?
11. How long should migrated local files be retained after Supabase verification: 30 days, longer, or until manual deletion?
12. Should non-medical NFs stay in the existing finance flow, or should Health Hub keep a rejected/non-medical record for audit?
13. Does Celina need a portal view, or is email with attachments/signed links enough?
14. Are AI/OCR calls allowed to process all medical documents through the existing Vertex/Gemini setup, or are any documents too sensitive for automated extraction?
15. What is the final Round 1 lifecycle state list, and should Round 3 rename the send-ready state to `ready_to_send` for clarity?
