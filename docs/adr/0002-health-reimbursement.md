# ADR 0002 — Health section: insurance-policy brain + automatic reimbursement eligibility

Status: Accepted (2026-06-06)
Owner: Mickael

## Context

The app already extracts medical notas fiscais and links them to bank payments
(installment-aware). The missing piece is *insurance reimbursement intelligence*:
knowing, for each medical bill, whether the insurance policy reimburses it and
up to what limit. Today that judgment lives only in Mickael's head.

Brazilian health-plan reimbursement (reembolso) is rule-dense and varies per
policy: percentage of value OR a "múltiplo" of a base unit (US/CH), per-event
caps, annual ceilings, per-category session limits (e.g. 40 psicoterapia/year),
carências, and document requirements (most reimbursements require the **pedido
médico / prescription** alongside the nota fiscal).

## Decision

Build a **Health section** with three capabilities. **Payment/submission to the
insurer is explicitly OUT OF SCOPE** — that happens in a separate app. We only
*determine eligibility and limits*.

### 1. Policy brain (ingest → structured rules)
User uploads a policy document. An AI extracts it into structured rows:
`insurance_policies` (the policy) + `policy_dependents` (who's covered) +
`policy_coverage_rules` (the "data per data": %, caps, multiples, annual/session
limits, carência, prescription requirement). Every rule keeps a `source_quote`
of the exact policy text it came from, so it's verifiable — never an unsourced
AI guess.

### 2. Eligibility engine (hybrid AI + deterministic math)
Given a nota (patient, service description, amount, date) and the policy:
- **AI** maps the messy NF service description to a coverage `category`
  (the fuzzy step LLMs are good at).
- **Deterministic code** computes the money: `eligible = min(amount·pct OR
  multiple·count, cap, remaining_annual_limit)`, checks session counts, carência,
  and the prescription requirement.
- Output: `eligibility` (eligible / not_eligible / partial / over_limit /
  needs_prescription / needs_review) + `eligible_amount` + `reasoning`.

This mirrors the payment matcher's proven split: AI for judgment, code for the
arithmetic/limits (so the numbers are auditable, not hallucinated).

### 3. Mobile scan + document pairing
A mobile (camera) flow captures the **nota fiscal AND the doctor's prescription**
and stores them paired via `reimbursement_claims` (NF + `medical_documents`).
Insurers require both together; the pairing is a first-class concept, not an
afterthought.

## Data model (migration 0018)

`insurance_policies` · `policy_dependents` · `policy_coverage_rules` ·
`medical_documents` · `reimbursement_claims` (one per NF; pairs NF + prescription
+ policy and records the determination).

## Consequences

- Reimbursement determination becomes explainable and auditable (source quotes +
  shown math), consistent with the radical-honesty mandate.
- New env need: a vision model for OCR of scanned NFs/prescriptions — reuse the
  existing Gemini/Vertex + Anthropic keys already configured.
- The policy parser is only as good as the policy doc provided; rules are
  reviewable/editable before they drive determinations.

## Non-goals

- No payment, no submission to the insurer, no reimbursement-status-after-sending
  (separate app). We stop at "eligible? within limit? how much?".
