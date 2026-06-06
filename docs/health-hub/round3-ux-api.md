# Health Hub Round 3 UX and API

This document specifies the Round 3 Health Hub user experience and API surface for the `/health-hub` route prefix. It uses the prior database, auth, storage, ingestion, email outbox, and role decisions as fixed inputs.

The claim readiness rule is strict: a claim cannot be sent to Celina until all three required parts are assembled and valid:

1. Payment proof from Pluggy.
2. NF or recibo with a mandatory service description.
3. Prescription document.

When all gates pass, the claim can move to `ready_to_send`. The email worker then sends the assembled claim to Celina from Mickael Gmail using the `gmail.send` scope.

## 1. ROUTES AND SCREENS

### Route Inventory

| Route path | React component | Mickael access | Ayelet access | Celina access | Nav placement |
| --- | --- | --- | --- | --- | --- |
| `/health-hub` | `HealthHubHomePage` | Full Health Hub access, including finance and admin panels. | Health Hub and portal access, no finance/admin panels. | Redirects to `/health-hub/queue`. | Primary nav. |
| `/health-hub/patients` | `PatientRegistryPage` | Full access. | No access. | No access. | Admin nav. |
| `/health-hub/patients/[patientId]` | `PatientDetailPage` | Full access. | Access to permitted family patient details. | No access. | Patient detail link from patient and claim screens. |
| `/health-hub/patients/[patientId]/claims` | `ClaimListPage` | Full access. | Access to permitted family patient claims, without finance/admin actions. | No access. | Patient detail secondary nav. |
| `/health-hub/claims/[id]` | `ClaimDetailPage` | Full access to assembly, finance, email, audit, and state actions. | Access to assembly and non-financial claim details. | Limited claim access for sent workflow only. | Claim links from hub, patient claims, queue, upload results, and notifications. |
| `/health-hub/claims/[id]/money-received` | `MoneyReceivedPage` | Full access. | No access. | No access. | Claim detail money-received action. |
| `/health-hub/upload` | `BulkUploadPage` with `BulkUploadModal` | Full upload and claim attach access. | Upload and attach access for permitted patients, no finance/admin panels. | No access. | Primary nav. |
| `/health-hub/scan` | `ScanPage` | Full scan and attach access. | Scan and attach access for permitted patients, no finance/admin panels. | No access. | Mobile floating action button. |
| `/health-hub/mapping` | `PatientMappingPage` | Full access. | No access. | No access. | Admin nav. |
| `/health-hub/policies` | `PolicyPage` | Full access to current policy view and future policy administration surface. | No access. | No access. | Admin nav. |
| `/health-hub/audit` | `AuditPage` | Full access, including sessions panel and audit timeline. | No access. | No access. | Admin nav. |
| `/health-hub/queue` | `CelinaQueuePage` | No default nav placement; admin may open only for support if explicitly granted later. | No access. | Full secretary queue access. Login redirect target. | Secretary landing route. |
| `/health-hub/login` | `LoginPage` | Public before authentication. | Public before authentication. | Public before authentication. | Public auth route, not shown in authenticated nav. |

### Route Guard and Role Model

All authenticated routes under `/health-hub` use the `hh_session` cookie and the Health Hub actor helpers:

- `getHealthHubActor()` resolves the active user, roles, patient access, and display name.
- `assertHealthHubPermission()` enforces route and action permissions.
- Middleware accepts only `health_admin`, `health_member`, or `health_secretary` for `/health-hub/:path*`.
- Mickael has `health_admin` and full access.
- Ayelet has `health_member`; she can use the Health Hub and patient portal surfaces, but cannot see finance/admin content or admin actions.
- Celina has `health_secretary`; she can access only Health Hub secretary screens, and all document access is logged.

Family members represented in the Health Hub are Mickael, Ayelet, Lavi, Lya, and Mila.

### Home Screen

`HealthHubHomePage` shows a work queue for family claims:

- Draft and incomplete claims grouped by missing gate: payment proof, NF/recibo, prescription, patient mapping, medical review, eligibility.
- Ready and sent claims grouped by lifecycle state.
- Deadline tracking using `DeadlineBadge`.
- Primary actions for Mickael and Ayelet: upload files, scan a document, open patient claims, and continue assembly.
- Mickael-only widgets: money received, follow-up needed, Gmail/outbox status, mapping candidates, audit and sessions.
- Ayelet does not see finance totals, bank accounts, policy administration, Gmail status, full audit, or admin navigation.

### Mobile Scan Screen

`ScanPage` is optimized for mobile capture and uses five steps:

1. `CameraView`
   - Uses `navigator.mediaDevices` when available.
   - Falls back to `<input type="file" accept="image/*" capture="environment">` for iOS and constrained browsers.
   - Shows a document-frame overlay and capture button.

2. `CapturePreviewPanel`
   - Shows the captured photo.
   - Provides `Retake` and `Use this photo` buttons.
   - Keeps image orientation metadata for upload normalization.

3. `DocTypePicker`
   - Lets the user choose `NF`, `Recibo`, `Prescription`, or `Other`.
   - Includes `AssignClaimDropdown` for linking to an existing open claim.
   - Allows continuing without a claim assignment; mapping can be resolved later.

4. `UploadProgressIndicator`
   - Shows `uploading X%` during staging upload.
   - Switches to `analyzing` while OCR and classification run.
   - Handles retry for network failure without losing the captured file.

5. `RecognitionResultCard`
   - Shows detected fields before saving: patient, provider, service date, issue date, amount, document type, and confidence.
   - Requires confirm or correction before the document is saved as a claim asset.
   - Calls the same ingestion confirmation path as bulk upload.

### Celina Queue Screen

`CelinaQueuePage` displays only the minimum details needed for secretary handling. Each claim row shows:

- Patient first name only.
- Provider name.
- Service date.
- Status badge with one of `sent_to_celina`, `secretary_received`, or `secretary_sent`.
- Deadline date.
- `View Details` button.

The queue does not show amounts, policy details, patient full names, other patients, payment proof details, finance status, or audit events.

### Celina Claim Detail View

On `/health-hub/claims/[id]`, Celina sees only the sent workflow panel:

- Patient first name.
- Provider name.
- Service date.
- Status badge.
- Deadline badge.
- Document list where each row has a `View Document` button that calls the signed-link exchange endpoint.
- `Confirm Received` button only when `claim_state = sent_to_celina`.
- `Confirm Sent` button and optional submission reference field only when `claim_state = secretary_received`.
- A restricted timeline containing only `sent_to_celina`, `secretary_received`, and `secretary_sent` events without financial data.

Celina does not see assembly edit buttons, BRL or EUR amounts, the money-received panel, eligibility, policy, Pluggy payment data, or the full audit timeline.

## 2. CLAIM DETAIL PAGE

### Component and Route

`ClaimDetailPage` renders at `/health-hub/claims/[id]`.

The page is role-aware:

- Mickael sees all claim, assembly, lifecycle, email, money, and audit panels.
- Ayelet sees claim assembly, document status, deadline, and non-financial audit events, with no finance/admin controls.
- Celina sees only the restricted sent workflow described in Section 1.

### Three-Part Assembly Panel

`ClaimAssemblyPanel` is always based on three required parts. The claim cannot become `ready_to_send` unless payment proof, NF/recibo, and prescription are present and accepted.

#### Payment Part

The payment part is sourced from Pluggy transaction data and includes:

- `amount_brl`.
- `payment_date`.
- `payment_method`.
- Account name.
- Payment matching details.
- Status badge:
  - `missing`: no Pluggy transaction linked.
  - `matched`: a likely Pluggy transaction is linked but not confirmed.
  - `confirmed`: the payment proof is accepted for the claim.

Mickael can confirm or correct the payment match. Ayelet can view the payment assembly status without seeing finance/admin panels. Celina cannot view payment data.

#### NF/Recibo Part

The NF/recibo part includes:

- File thumbnail when previewable, otherwise a file-type icon.
- Issuer/provider name.
- Value.
- Mandatory `service_description`, truncated in the panel with full text available in a detail popover for Mickael and Ayelet.
- Document number: NF number, access key, or recibo number when available.
- Status badge:
  - `missing`: no NF/recibo attached.
  - `attached_unreviewed`: attached but not reviewed.
  - `accepted`: accepted for submission.
  - `needs_clarification`: attached but requires correction or review.
  - `rejected`: rejected and not usable for readiness.
- Actions for Mickael and Ayelet:
  - `Attach file`.
  - `Scan`.
  - `View file`.

The service description is mandatory. A document without a service description cannot be accepted and keeps the claim in an assembly state.

#### Prescription Part

The prescription part includes:

- File thumbnail when previewable, otherwise a file-type icon.
- Doctor name.
- Prescription date.
- Validity start date and validity end date when available.
- Status badge:
  - `missing`: no prescription attached.
  - `attached_unreviewed`: attached but not reviewed.
  - `accepted`: accepted for submission.
  - `needs_clarification`: attached but requires correction or review.
  - `rejected`: rejected and not usable for readiness.
- Actions for Mickael and Ayelet:
  - `Attach file`.
  - `Scan`.
  - `View file`.

Prescription is mandatory for the current Health Hub reimbursement flow. The claim cannot become `ready_to_send` while prescription status is `missing`, `attached_unreviewed`, `needs_clarification`, or `rejected`.

### DeadlineBadge

`DeadlineBadge` uses `filing_deadline_date` and the current date:

| Range | Color | Text |
| --- | --- | --- |
| More than 30 days remaining | Green | `{X} dias para arquivar` |
| 8 to 30 days remaining | Yellow | `{X} dias para arquivar` |
| 1 to 7 days remaining | Red | `{X} dias para arquivar` |
| Past deadline | Dark red with pulsing treatment | `VENCIDO` |

The badge is visible to Mickael, Ayelet, and Celina, but Celina sees only the date urgency and not policy or amount context.

### StateTransitionPanel

`StateTransitionPanel` shows the current lifecycle state, allowed next actions for the actor, and blocked readiness reasons.

| State | Meaning | Mickael actions | Ayelet actions | Celina actions | Typical next states |
| --- | --- | --- | --- | --- | --- |
| `draft` | Claim exists but assembly has not been completed. | Edit assembly, attach/detach documents, confirm payment, cancel. | Edit assembly and attach/detach permitted documents. | None. | `needs_documents`, `needs_patient_mapping`, `needs_medical_review`, `eligibility_pending`, `ready_to_send`, `cancelled`. |
| `needs_documents` | One or more required parts are missing or not accepted. | Attach/scan documents, resolve document status, cancel. | Attach/scan documents for permitted patients. | None. | `draft`, `needs_patient_mapping`, `needs_medical_review`, `eligibility_pending`, `ready_to_send`, `cancelled`. |
| `needs_patient_mapping` | OCR or uploaded document could not be confidently matched to a family member. | Navigate to `/health-hub/mapping`, review candidate, add alias, assign patient. | View blocked status only. | None. | `needs_documents`, `needs_medical_review`, `eligibility_pending`, `ready_to_send`. |
| `needs_medical_review` | Medical classification needs admin review before submission. | Approve or correct medical classification. | View blocked status only. | None. | `needs_documents`, `eligibility_pending`, `ready_to_send`. |
| `eligibility_pending` | Required documents are assembled, but eligibility is not confirmed. | Use `Assumir elegivel` with a reason. | View blocked status only. | None. | `ready_to_send`. |
| `ready_to_send` | All pre-send gates pass and an outbox row exists or can be created. | Trigger email via `triggerClaimEmail`; view outbox status. | View only. | None. | `sending_to_celina`. |
| `sending_to_celina` | Email worker is sending the claim. | Read-only; can inspect outbox status. | Read-only. | None. | `sent_to_celina`, or back to `ready_to_send` if worker retry is pending. |
| `sent_to_celina` | Email was sent to Celina and the claim awaits secretary receipt confirmation. | Mark follow-up needed or create revision. | View only. | `Confirm Received`. | `secretary_received`, `follow_up_needed`, `revision_needed`. |
| `secretary_received` | Celina confirmed she received the package. | Mark follow-up needed. | View only. | `Confirm Sent` with optional submission reference. | `secretary_sent`, `follow_up_needed`. |
| `secretary_sent` | Celina confirmed the claim was sent to the insurer. | Record money received, mark rejected if insurer rejects, follow up if needed. | View only, no finance panel. | View restricted sent status only. | `money_received`, `rejected`, `follow_up_needed`. |
| `money_received` | Reimbursement money was received and recorded. | Close claim or record additional receipt if partial. | View non-financial completion state only. | No action. | `closed`. |
| `follow_up_needed` | Mickael needs to follow up with Celina or the insurer. | Re-send without a new submission version, or create a revision. | View status and attach documents only if reassembly is opened. | No action. | `ready_to_send`, `revision_needed`, `rejected`. |
| `revision_needed` | A new version must be assembled before re-sending. | Reassemble documents, update notes, mark ready when gates pass. | Reassemble permitted documents. | No action. | `needs_documents`, `needs_patient_mapping`, `needs_medical_review`, `eligibility_pending`, `ready_to_send`. |
| `rejected` | Insurer or admin rejected the claim. | Close claim or create revision. | View status only. | No action. | `closed`, `revision_needed`. |
| `cancelled` | Claim was cancelled before being sent. | View terminal cancelled state. | View terminal cancelled state when patient access allows. | No action. | Terminal. |
| `closed` | Claim is complete and archived. | View terminal closed state. | View terminal closed state when patient access allows. | No action. | Terminal. |

Only a transition into `ready_to_send` creates or verifies the single idempotent outbox row for Celina. Worker states (`sending_to_celina`, `sent_to_celina`) are not manually set by Ayelet or Celina.

### MoneyReceivedPanel

`MoneyReceivedPanel` is visible only to Mickael and only when the claim is at or after `secretary_sent`.

Fields:

- `received_amount_eur`.
- `received_on`.
- `france_bank_account` label.
- `exchange_rate_brl_per_eur`, when set.
- `received_amount_brl_equivalent`.
- `claimed_amount_brl`.
- `delta`, calculated as `received_amount_brl_equivalent - claimed_amount_brl`.
- Reimbursement badge:
  - `partial` when the BRL equivalent is lower than the claimed amount.
  - `full` when the BRL equivalent matches the claimed amount within the configured tolerance.
  - `overpaid` when the BRL equivalent is greater than the claimed amount.

`Add receipt` opens `MoneyReceivedModal`, which captures EUR amount, receipt date, France bank account, optional exchange rate, and notes. The modal writes to `claim_reimbursement_receipts`.

### AuditTimeline

`AuditTimeline` is newest first. Each event shows:

- Actor display name.
- Action label.
- Timestamp.
- Optional note.

Mickael and Ayelet see all claim events that are allowed for their role and patient access. Mickael sees financial and admin audit events. Ayelet does not see finance/admin-only event descriptions.

Celina sees only:

- `sent_to_celina`.
- `secretary_received`.
- `secretary_sent`.

Celina event descriptions must not include amounts, Pluggy data, eligibility, policy details, bank accounts, or reimbursement results.

## 3. BULK UPLOAD UX

`BulkUploadModal` is available as a modal from Health Hub surfaces and as the standalone `BulkUploadPage` at `/health-hub/upload`.

### Step 1 - DropZone

`DropZone` provides:

- Drag-and-drop area.
- Click-to-browse button.
- Accepted file types: PDF, JPG, PNG, HEIC.
- Maximum size: 20MB per file.
- Maximum session size: 50 files.
- Immediate visual grouping of selected files before validation.

### Step 2 - File Validation

Client-side validation runs instantly. Each file row shows:

- File name.
- Size.
- Type.
- Status.

Error badges:

- `Wrong type` for unsupported extensions or MIME types.
- `Too large` for files above 20MB.

The `Continue` button is enabled when at least one selected file is valid.

### Step 3 - Upload Progress

Valid files are uploaded to `/api/health-hub/ingestion/upload`.

The progress view shows:

- Per-file `ProgressBar` with filename and percentage.
- Session-level bar with `Enviando X de Y`.
- Per-row cancel-file `X` button.
- Retry state for failed uploads.

Cancelled files remain in the local session list with a cancelled status and are not sent to OCR.

### Step 4 - RecognitionResultsList

After server OCR and classification, `RecognitionResultsList` renders a card per file:

- File thumbnail.
- Detected type badge: `NF`, `Recibo`, `Prescription`, or `Unknown`.
- Confidence color:
  - Green for high confidence.
  - Yellow for review.
  - Red for low confidence.
- Detected patient name.
- Detected provider name.
- Detected date.
- Detected amount.
- `AssignPatientDropdown`, pre-selected when auto-matched with high confidence.
- Optional `AssignClaimDropdown` for open claims.

Low-confidence cards require manual review before confirmation.

### Step 5 - DedupWarningCard

`DedupWarningCard` appears in yellow when `dedup_status` is one of:

- `duplicate_file`.
- `duplicate_document`.
- `possible_duplicate`.

The card shows a link to the existing document and the dedup reason. Actions per warning:

- `Usar existente`: skips the new upload and links the existing document to the selected claim.
- `Enviar mesmo assim`: overrides dedup and imports the new file.
- `Ignorar`: removes the file from the ingestion session.

### Step 6 - ConfirmRejectPanel

Each item has:

- `Confirm` button.
- `Skip` button.

Bulk actions:

- `Confirmar todos`.
- `Ignorar todos`.

`Confirm` calls `confirmIngestionItem`, which creates the document row and optionally attaches it to the selected claim. `Skip` marks the file rejected in the ingestion session.

### Step 7 - IngestionSummary

The summary screen shows:

- `X documentos importados`.
- `Y duplicados ignorados`.
- `Z erros`.
- Links to affected claims.
- `Return to hub` button.

The summary preserves session history so Mickael or Ayelet can open imported documents and finish claim assembly.

## 4. API AND SERVER ACTIONS

Each API or server action is specified with the required eight fields: type, name/path, caller roles, input, effect, lifecycle transition, audit, and notification.

### Ingestion

#### 1. uploadDocuments

- Type: server-action.
- Name/path: `uploadDocuments`.
- Caller roles: `health_admin`, `health_member`.
- Input: files and optional ingestion session metadata, selected source, client file metadata, optional provisional patient or claim assignment.
- Effect: Creates `health_ingestion_sessions` and `health_ingestion_files`, uploads files to the private `health-ingestion-staging` bucket, stores file metadata, and triggers OCR/classification.
- Lifecycle transition: No claim transition.
- Audit: `document_upload`.
- Notification: none.

#### 2. getIngestionSession

- Type: server-action.
- Name/path: `getIngestionSession`.
- Caller roles: `health_admin`, `health_member`.
- Input: `getIngestionSession(sessionId)`.
- Effect: Returns the ingestion session, files, validation results, OCR/classification output, dedup status, and current confirmation statuses.
- Lifecycle transition: none.
- Audit: none.
- Notification: none.

#### 3. confirmIngestionItem

- Type: server-action.
- Name/path: `confirmIngestionItem`.
- Caller roles: `health_admin`, `health_member`.
- Input: `confirmIngestionItem({sessionId, fileId, decision, patientId?, claimId?, documentRole?, useExistingDocumentId?, overrideDedup?, correctedFields?})`, where `decision` is `accept`, `reject`, `skip`, or `use_existing`.
- Effect: For `accept`, moves the file from staging to the private `health-documents` bucket, creates a `health_document_assets` row, creates or updates the parsed document record, and optionally attaches it to a claim. For `reject` or `skip`, marks the file rejected in the ingestion session. For `use_existing`, links the existing document to the selected claim and skips the staged upload.
- Lifecycle transition: May trigger `computeClaimReadiness` and advance or revert the claim state.
- Audit: `document_upload`.
- Notification: none.

### Assembly

#### 4. createClaim

- Type: server-action.
- Name/path: `createClaim`.
- Caller roles: `health_admin`, `health_member`.
- Input: `createClaim({patientId, notaFiscalId?, prescriptionId?, insurancePolicyId?})`.
- Effect: Inserts a `reimbursement_claims` row with `claim_state = draft`, initial `submission_version = 1`, selected patient, and optional document references.
- Lifecycle transition: Sets state to `draft`.
- Audit: `claim_update` with action label `created`.
- Notification: none.

#### 5. attachDocumentToClaim

- Type: server-action.
- Name/path: `attachDocumentToClaim`.
- Caller roles: `health_admin`, `health_member`.
- Input: `attachDocumentToClaim(claimId, documentId, role)`, where `role` is payment proof reference, NF/recibo, prescription, or supporting document as allowed by the schema.
- Effect: Updates the relevant claim foreign key or attachment relationship and calls `computeClaimReadiness`.
- Lifecycle transition: May advance the state when gates are satisfied or keep it blocked with explicit missing reasons.
- Audit: `document_attached`.
- Notification: none.

#### 6. detachDocumentFromClaim

- Type: server-action.
- Name/path: `detachDocumentFromClaim`.
- Caller roles: `health_admin`, `health_member`.
- Input: `detachDocumentFromClaim(claimId, role)`.
- Effect: Nulls the relevant claim foreign key or removes the attachment relationship and calls `computeClaimReadiness`.
- Lifecycle transition: May revert the state to `draft`, `needs_documents`, `needs_patient_mapping`, `needs_medical_review`, or `eligibility_pending`.
- Audit: `document_detached`.
- Notification: none.

#### 7. computeClaimReadiness

- Type: server-action, internal.
- Name/path: `computeClaimReadiness`.
- Caller roles: `health_admin`, `health_member`, or trusted internal caller.
- Input: `computeClaimReadiness(claimId)`.
- Effect: Checks payment proof from Pluggy, accepted NF/recibo with mandatory service description, accepted prescription, patient mapping, medical classification, and eligibility gates; updates `claim_state` and blocked reasons.
- Lifecycle transition: Sets state to `draft`, `needs_documents`, `needs_patient_mapping`, `needs_medical_review`, or `eligibility_pending`; it does not send email by itself.
- Audit: none.
- Notification: none.

#### 8. assumeEligible

- Type: server-action.
- Name/path: `assumeEligible`.
- Caller roles: `health_admin` only.
- Input: `assumeEligible(claimId, reason)`.
- Effect: Inserts a `health_eligibility_results` row with `assumed_eligible`, sets `eligibility_confirmed = true`, and stores the admin reason.
- Lifecycle transition: `eligibility_pending -> ready_to_send` if all other gates pass.
- Audit: `eligibility_assumed`.
- Notification: none.

### Transitions

#### 9. markClaimReadyToSend

- Type: server-action.
- Name/path: `markClaimReadyToSend`.
- Caller roles: `health_admin` only.
- Input: `markClaimReadyToSend(claimId)`.
- Effect: Validates readiness, sets `claim_state = ready_to_send`, and creates the idempotent outbox row with key `celina:{claim_id}:{version}:{email}`.
- Lifecycle transition: `any_pre_send -> ready_to_send`.
- Audit: `marked_ready_to_send`.
- Notification: in-app notification to Mickael.

#### 10. cancelClaim

- Type: server-action.
- Name/path: `cancelClaim`.
- Caller roles: `health_admin` only, not allowed after `sent_to_celina`.
- Input: `cancelClaim(claimId, reason)`.
- Effect: Sets `claim_state = cancelled`, stores the reason, and cancels any pending outbox row.
- Lifecycle transition: `any_pre_sent -> cancelled`.
- Audit: `cancelled`.
- Notification: none.

#### 11. markFollowUpNeeded

- Type: server-action.
- Name/path: `markFollowUpNeeded`.
- Caller roles: `health_admin` only.
- Input: `markFollowUpNeeded(claimId, note)`.
- Effect: Sets `claim_state = follow_up_needed` and stores the follow-up note.
- Lifecycle transition: `sent_to_celina` or `secretary_received -> follow_up_needed`.
- Audit: `follow_up_flagged`.
- Notification: in-app notification to Mickael.

#### 12. createRevision

- Type: server-action.
- Name/path: `createRevision`.
- Caller roles: `health_admin` only.
- Input: `createRevision(claimId, reason)`.
- Effect: Increments `submission_version`, sets `claim_state = revision_needed`, stores the reason, and cancels any pending outbox row for the old version.
- Lifecycle transition: `sent_to_celina` or `rejected -> revision_needed`.
- Audit: `revision_created`.
- Notification: none.

#### 13. markClaimRejected

- Type: server-action.
- Name/path: `markClaimRejected`.
- Caller roles: `health_admin` only.
- Input: `markClaimRejected(claimId, rejectionReason)`.
- Effect: Sets `claim_state = rejected` and stores the rejection reason.
- Lifecycle transition: `secretary_sent` or `follow_up_needed -> rejected`.
- Audit: `rejected`.
- Notification: in-app notification to Mickael.

#### 14. closeClaim

- Type: server-action.
- Name/path: `closeClaim`.
- Caller roles: `health_admin` only.
- Input: `closeClaim(claimId)`.
- Effect: Sets `claim_state = closed` and records closure metadata.
- Lifecycle transition: `money_received` or `rejected -> closed`.
- Audit: `closed`.
- Notification: none.

### Email Send

#### 15. triggerClaimEmail

- Type: server-action.
- Name/path: `triggerClaimEmail`.
- Caller roles: `health_admin` only.
- Input: `triggerClaimEmail(claimId)`.
- Effect: Verifies readiness and creates or verifies the idempotent outbox row for the current `claim_id`, `submission_version`, and Celina email.
- Lifecycle transition: none; the worker handles `ready_to_send -> sending_to_celina -> sent_to_celina`.
- Audit: `email_triggered`.
- Notification: none.

#### 16. GET /api/health-hub/email-worker

- Type: Vercel cron route handler.
- Name/path: `GET /api/health-hub/email-worker`.
- Caller roles: system caller authenticated by `CRON_SECRET`.
- Input: `CRON_SECRET` header or query secret according to deployment convention; no user input.
- Effect: Selects up to 5 `health_email_outbox` rows with status `pending` or `retry_pending` and `next_attempt_at <= now()`, marks each claim `sending_to_celina`, generates the summary PDF into `health-generated`, assembles MIME attachments or signed links when total attachment size exceeds 20MB, sends via Mickael Gmail using `gmail.send`, and updates outbox/send log status.
- Lifecycle transition: `ready_to_send -> sending_to_celina -> sent_to_celina` on success; retry backoff on failure with `retry_pending` or `failed`.
- Audit: `health_email_send_log` row.
- Notification: in-app notification to Mickael on sent or failed.

#### 17. retryFailedEmail

- Type: server-action.
- Name/path: `retryFailedEmail`.
- Caller roles: `health_admin` only.
- Input: `retryFailedEmail(outboxId)`.
- Effect: Resets the selected outbox row to `retry_pending`, clears terminal failure metadata as appropriate, and sets `next_attempt_at` for retry.
- Lifecycle transition: none.
- Audit: `retry_triggered`.
- Notification: none.

#### 18. reconnectGmail

- Type: server-action.
- Name/path: `reconnectGmail`.
- Caller roles: `health_admin` only.
- Input: `reconnectGmail()`.
- Effect: Generates a Google OAuth URL requesting the `gmail.send` scope for Mickael Gmail and records reconnect initiation metadata.
- Lifecycle transition: none.
- Audit: `gmail_reconnect_initiated`.
- Notification: none.

### Money Receipt

#### 19. recordMoneyReceived

- Type: server-action.
- Name/path: `recordMoneyReceived`.
- Caller roles: `health_admin` only.
- Input: `recordMoneyReceived(claimId, {received_amount_eur, received_on, france_bank_account_id, exchange_rate_brl_per_eur?, notes?})`.
- Effect: Inserts `claim_reimbursement_receipts`, computes BRL equivalent when an exchange rate is provided, calculates delta from `claimed_amount_brl`, and stores notes.
- Lifecycle transition: `secretary_sent -> money_received`.
- Audit: `receipt_create`.
- Notification: in-app notification to Mickael.

#### 20. listFranceBankAccounts

- Type: server-action.
- Name/path: `listFranceBankAccounts`.
- Caller roles: `health_admin` only.
- Input: no input.
- Effect: Returns active `france_bank_accounts` rows for EUR reimbursement receipt selection.
- Lifecycle transition: none.
- Audit: none.
- Notification: none.

#### 21. addFranceBankAccount

- Type: server-action.
- Name/path: `addFranceBankAccount`.
- Caller roles: `health_admin` only.
- Input: `addFranceBankAccount({account_label, bank_name, iban_last4})`.
- Effect: Inserts a `france_bank_accounts` row with `currency = EUR`.
- Lifecycle transition: none.
- Audit: `bank_account_added`.
- Notification: none.

### Patient Mapping

#### 22. listPatientMappingCandidates

- Type: server-action.
- Name/path: `listPatientMappingCandidates`.
- Caller roles: `health_admin` only.
- Input: optional filter for status, patient text, source document, or confidence.
- Effect: Returns `health_patient_match_candidates` with document preview and candidate metadata.
- Lifecycle transition: none.
- Audit: none.
- Notification: none.

#### 23. reviewMappingCandidate

- Type: server-action.
- Name/path: `reviewMappingCandidate`.
- Caller roles: `health_admin` only.
- Input: `reviewMappingCandidate(candidateId, decision, patientId?, addAlias?)`.
- Effect: Sets the candidate decision, updates `patient_id` on the source document when accepted, optionally inserts a normalized alias, and calls `computeClaimReadiness`.
- Lifecycle transition: May resolve `needs_patient_mapping`.
- Audit: `patient_mapped`.
- Notification: none.

#### 24. createPatientAlias

- Type: server-action.
- Name/path: `createPatientAlias`.
- Caller roles: `health_admin` only.
- Input: `createPatientAlias(patientId, aliasRaw)`.
- Effect: Normalizes the alias and inserts `health_patient_aliases` with `source = manual`.
- Lifecycle transition: none.
- Audit: `alias_added`.
- Notification: none.

#### 25. createPatient

- Type: server-action.
- Name/path: `createPatient`.
- Caller roles: `health_admin` only.
- Input: `createPatient({legal_name, display_name, relationship_to_mickael, date_of_birth?, insurer_member_id?, notes?})`.
- Effect: Inserts a `health_family_members` row.
- Lifecycle transition: none.
- Audit: `patient_created`.
- Notification: none.

#### 26. updatePatient

- Type: server-action.
- Name/path: `updatePatient`.
- Caller roles: `health_admin` only.
- Input: `updatePatient(patientId, input)`.
- Effect: Updates the selected `health_family_members` row.
- Lifecycle transition: none.
- Audit: `patient_updated`.
- Notification: none.

### Auth and Login

#### 27. POST /api/health-hub/auth/request-link

- Type: route handler.
- Name/path: `POST /api/health-hub/auth/request-link`.
- Caller roles: public.
- Input: `{email}`.
- Effect: Validates that the email exists in active `app_users`, returns 200 for all requests to prevent enumeration, and when found inserts an `app_login_challenges` row with `sha256(random32)`, `expires_at = now() + 15 minutes`, IP address, user agent, and `attempt_count = 0`.
- Lifecycle transition: none.
- Audit: none before authentication.
- Notification: sends magic link email to the user with subject `Seu link de acesso - Health Hub`.

#### 28. GET /api/health-hub/auth/verify

- Type: route handler.
- Name/path: `GET /api/health-hub/auth/verify`.
- Caller roles: public link click.
- Input: `token` and `next` query params.
- Effect: Hashes the raw token, looks up `app_login_challenges`, validates expiry, consumed status, and attempt limit, marks the challenge consumed, inserts `app_auth_sessions`, sets the `hh_session` cookie, and redirects to a validated `next` path or role home. Already-consumed tokens revoke the associated session and return 400; expired tokens return 400; attempts greater than or equal to 5 return 429.
- Lifecycle transition: none.
- Audit: `login` on success.
- Notification: security alert to Mickael on double-use.

#### 29. POST /api/health-hub/auth/logout

- Type: route handler.
- Name/path: `POST /api/health-hub/auth/logout`.
- Caller roles: any authenticated Health Hub actor.
- Input: active `hh_session` cookie.
- Effect: Sets `revoked_at = now()` on the session, clears the `hh_session` cookie with `Max-Age = 0`, and redirects to `/health-hub/login`.
- Lifecycle transition: none.
- Audit: `logout`.
- Notification: none.

#### 30. revokeSession

- Type: server-action.
- Name/path: `revokeSession`.
- Caller roles: `health_admin` only.
- Input: `revokeSession(sessionId)`.
- Effect: Sets `revoked_at = now()` on the selected `app_auth_sessions` row.
- Lifecycle transition: none.
- Audit: `session_revoked`.
- Notification: none.

#### 31. GET /api/health-hub/documents/[token]

- Type: route handler.
- Name/path: `GET /api/health-hub/documents/[token]`.
- Caller roles: public, where the token is the authorization secret.
- Input: token path parameter.
- Effect: Hashes the token, looks up `health_document_share_links`, validates expiry and revocation, creates a 60-second Supabase Storage signed URL, increments `access_count`, inserts `health_document_access_log`, and redirects to the signed URL. Invalid or expired tokens return 403.
- Lifecycle transition: none.
- Audit: `health_document_access_log`.
- Notification: none.

### Secretary Actions

#### 32. confirmClaimReceived

- Type: server-action.
- Name/path: `confirmClaimReceived`.
- Caller roles: `health_secretary` only.
- Input: `confirmClaimReceived(claimId)`.
- Effect: Validates `claim_state = sent_to_celina` and Celina access, then sets `claim_state = secretary_received`.
- Lifecycle transition: `sent_to_celina -> secretary_received`.
- Audit: `secretary_confirmed_received`.
- Notification: in-app notification to Mickael.

#### 33. confirmClaimSent

- Type: server-action.
- Name/path: `confirmClaimSent`.
- Caller roles: `health_secretary` only.
- Input: `confirmClaimSent(claimId, submissionReference?)`.
- Effect: Validates `claim_state = secretary_received`, stores optional submission reference, sets `submitted_to_insurer_at = now()`, and sets `claim_state = secretary_sent`.
- Lifecycle transition: `secretary_received -> secretary_sent`.
- Audit: `secretary_confirmed_sent`.
- Notification: in-app notification to Mickael.

### API Counts

| Group | Count |
| --- | ---: |
| Ingestion | 3 |
| Assembly | 5 |
| Transitions | 6 |
| Email Send | 4 |
| Money Receipt | 3 |
| Patient Mapping | 5 |
| Auth and Login | 5 |
| Secretary Actions | 2 |
| Total | 33 |

## 5. EMAIL TO CELINA

### Send Rules

The email to Celina is generated from the DB-backed outbox. The only state change that creates a Celina outbox row is transition into `ready_to_send`; the idempotency key is:

```text
celina:{claim_id}:{version}:{email}
```

The worker sends through Mickael Gmail using `gmail.send`. Before sending, the worker:

- Confirms the claim is still `ready_to_send`.
- Marks it `sending_to_celina`.
- Generates the summary sheet PDF in the private `health-generated` bucket.
- Loads original documents from the private `health-documents` bucket.
- Attaches files when total payload is at or below 20MB.
- Uses 7-day signed share links when attachments exceed 20MB.
- On success, marks outbox sent and moves the claim to `sent_to_celina`.
- On failure, applies retry backoff and records send-log details.

### Subject

```text
[Reembolso] {patient_first_name} - {provider_name} - {service_date_dd/mm/yyyy} (Claim #{claim_id_last4hex})
```

### Body

```text
Oi Celina,

Segue um novo pedido de reembolso para encaminhar ao plano de saude.

Paciente: {patient_display_name} ({patient_relationship})
Prestador: {provider_name}
Data do servico: {service_date_formatted}
Valor pago: R$ {claimed_amount_brl_formatted}
Valor solicitado: R$ {claimed_amount_brl_formatted}

O que fazer:
1. Confira os documentos em anexo (NF/recibo + receita medica + resumo).
2. Encaminhe ao plano conforme o procedimento habitual.
3. Confirme o recebimento acessando: {app_url}/health-hub/queue
4. Apos enviar ao plano, confirme o envio no mesmo link.
{signed_links_section}
Qualquer duvida: {household_contact_email}

Obrigado, {sender_display_name}
```

When attachments exceed 20MB, `{signed_links_section}` is:

```text
Documentos nao puderam ser anexados. Acesse (validos 7 dias):
NF/Recibo: {nf_link}
Receita: {rx_link}
```

Otherwise `{signed_links_section}` is empty.

### Attachments

1. `{id_short}-nf.pdf` or `{id_short}-nf.{ext}`: original NF or recibo from the `health-documents` bucket.
2. `{id_short}-prescricao.pdf` or `{id_short}-prescricao.{ext}`: prescription from the `health-documents` bucket. Prescription is mandatory in the current Health Hub flow.
3. `{id_short}-resumo-v{submission_version}.pdf`: generated summary sheet from the `health-generated` bucket.

If attachments exceed 20MB, the email includes signed links instead of the original NF/recibo and prescription attachments. The generated summary remains attached when possible; otherwise it is also shared by signed link and logged.

### Summary Sheet Required Fields

The generated summary sheet must include all 21 fields:

1. Claim ID full UUID.
2. Claim ID short, using the last 4 hex chars.
3. Submission version.
4. Patient full legal name.
5. Patient display name.
6. Patient relationship, such as `Filho`, `Filha`, or `Conjuge`.
7. Service category, such as `Consulta medica`, `Terapia`, or `Exame laboratorial`.
8. Provider name.
9. Provider CNPJ or CPF, if present.
10. Provider professional registration, such as CRM, CRO, CRP, CREFITO, CRFa, or CRN, if present.
11. NF number and access key, or recibo number, whichever applies.
12. Document issue date.
13. Service date or service period, formatted as `start - end` when a period exists.
14. Amount paid BRL formatted as `R$ X.XXX,XX`.
15. Reimbursement amount requested BRL.
16. Eligibility status label: `Elegivel confirmado`, `Assumido elegivel - revisao pendente`, or `Necessita revisao`.
17. Prescription status label: `Anexada`, `Nao obrigatoria`, or `Ausente - revisar`. Current Health Hub claims must use `Anexada` before sending; `Nao obrigatoria` is reserved for a future policy that explicitly removes the prescription gate.
18. Document checklist: `[x] Comprovante de pagamento`, `[x] NF/Recibo`, `[x]/[-] Receita medica`.
19. Notes for Celina, free text from Mickael when present.
20. Household contact email.
21. Generated at timestamp in ISO 8601 format.

## 6. LOGIN UX

The login flow is a named magic-link flow for Mickael, Ayelet, and Celina. There is no self-service account creation.

### Step 1 - LoginPage

`LoginPage` at `/health-hub/login` shows:

- Email input field.
- `Enviar link de acesso` button.
- No password field.
- No create-account link.
- Brief text: `Voce recebera um link por e-mail.`

### Step 2 - Request Link

`POST /api/health-hub/auth/request-link`:

- Accepts `{email}`.
- Validates that the email exists in `app_users` with `is_active = true`.
- Returns 200 for every request to avoid user enumeration.
- If the email is found, generates a 32-byte cryptographically random token.
- Stores the SHA-256 hash in `app_login_challenges`.
- Sets `expires_at = now() + 15 minutes`.
- Sets `attempt_count = 0`.
- Stores `ip_address` and `user_agent`.
- Sends an email from the system address with subject `Seu link de acesso - Health Hub`.
- Email body contains a magic link valid for 15 minutes.

Link format:

```text
{APP_URL}/api/health-hub/auth/verify?token={base64url_raw}&next={encoded_path}
```

### Step 3 - Verify Link

`GET /api/health-hub/auth/verify`:

- Decodes the base64url token.
- Hashes it with SHA-256.
- Looks up `app_login_challenges` by `challenge_hash`.
- Checks `expires_at > now()`.
- Checks `consumed_at is null`.
- Checks `attempt_count < 5`.

If valid:

- Marks `consumed_at = now()`.
- Creates an `app_auth_sessions` row.
- Uses `expires_at = now() + 7 days` for `health_admin` and `health_member`.
- Uses `expires_at = now() + 30 days` for `health_secretary`.
- Sets the `hh_session` cookie with:
  - `httpOnly`.
  - `Secure`.
  - `SameSite = Lax`.
  - `Path = /health-hub`.
  - Raw session token as the value.
- Redirects to the validated `next` path or role home.

Failure handling:

- Already consumed: revoke the associated session, send security alert email to Mickael, and return 400 `Este link ja foi utilizado.`
- Expired: return 400 `Este link expirou.`
- `attempt_count >= 5`: return 429.

### Step 4 - Role Homes

After login:

- `health_admin` redirects to `/health-hub`.
- `health_member` redirects to `/health-hub`.
- `health_secretary` redirects to `/health-hub/queue`.

### Step 5 - Session Management

Mickael and Ayelet:

- Receive 7-day sliding sessions.
- Middleware updates `last_seen_at` on authenticated requests.
- If `last_seen_at` is more than 7 days ago, the session is treated as expired.

Celina:

- Receives a 30-day non-sliding session.
- `last_seen_at` may be updated for audit visibility, but expiry does not slide.

### Step 6 - Middleware

Middleware for `/health-hub/:path*`:

- Reads the `hh_session` cookie.
- Hashes the raw session token with SHA-256.
- Looks up `app_auth_sessions`.
- Redirects to `/health-hub/login?reason=revoked` when `revoked_at is not null`.
- Redirects to `/health-hub/login?reason=expired` when the session is expired.
- Updates `last_seen_at` when valid.
- Attaches actor context headers for server actions and route handlers:
  - `actor_user_id`.
  - `actor_roles`.
  - `actor_display_name`.

### Step 7 - Logout

`LogoutButton` calls `POST /api/health-hub/auth/logout`.

The server:

- Reads the active `hh_session`.
- Sets `revoked_at = now()` on the session.
- Clears the `hh_session` cookie with `Max-Age = 0`.
- Redirects to `/health-hub/login`.

The login page shows:

```text
Voce saiu com seguranca.
```

### Step 8 - Double-Use Detection

If `GET /api/health-hub/auth/verify` is called with an already-consumed challenge token:

- The server revokes the associated session if it exists.
- The server sends a security alert email to Mickael.
- The server returns 400:

```text
Este link ja foi utilizado. Solicite um novo acesso.
```

Security alert subject:

```text
ALERTA: Link ja utilizado para {email}
```

### Step 9 - Celina Named-Secret Alternative

If magic-link email delivery to Celina is unreliable, the fallback is a named-secret URL:

- Mickael generates a 32-byte random secret.
- The server stores its SHA-256 hash in `app_users.secretary_token_hash`.
- Celina accesses:

```text
{APP_URL}/api/health-hub/auth/secretary?token={raw_secret}
```

The server validates the hash and creates a secretary session with the same rules as the verify endpoint.

Mickael can revoke the token with `revokeSecretaryToken()`:

- Caller roles: `health_admin` only.
- Effect: clears or rotates `app_users.secretary_token_hash`.
- Rotation: generate a new random secret, update the hash, and send the new URL to Celina out-of-band.

### Step 10 - Admin Session Management

`AuditPage` includes a Mickael-only sessions panel. It lists active `app_auth_sessions` with:

- User display name.
- `created_at`.
- `last_seen_at`.
- `ip_address`.
- `expires_at`.

Each session row has a `Revogar` button that calls `revokeSession(sessionId)`.
