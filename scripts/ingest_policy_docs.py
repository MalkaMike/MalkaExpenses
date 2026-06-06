"""
Policy-document understanding — runs Gemini 2.5 Pro (Vertex AI) over each
insurance policy PDF and extracts EVERY precise rule with a verbatim source
quote, so a human can verify the AI understood the document before anything is
saved. VERIFICATION FIRST — this script only reads + prints + writes JSON to
docs/health-hub/extracted/; it does NOT write to the database.

Uses Vertex REST + gcloud ADC token (the app's provider; ANTHROPIC key is unset).

Usage:
    python -X utf8 scripts/ingest_policy_docs.py "<file1.pdf>" "<file2.pdf>" ...
    python -X utf8 scripts/ingest_policy_docs.py --all     # the 7 APRIL docs in Downloads
"""

import sys
import json
import base64
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _nf_db import load_env  # noqa: E402

PROJECT = load_env().get("GOOGLE_VERTEX_PROJECT", "ai-first-mm")
LOCATION = load_env().get("GOOGLE_VERTEX_LOCATION", "us-central1")
MODEL = "gemini-2.5-pro"
OUT_DIR = Path(__file__).parent.parent / "docs" / "health-hub" / "extracted"

DOWNLOADS = Path.home() / "Downloads"
APRIL_DOCS = [
    "Table of Benefits.pdf",
    "General Conditions.pdf",
    "Insurance Certificate.pdf",
    "Member Guide.pdf",
    "Insurance Product Information Document.pdf",
    "Confidential medical certificate.pdf",
    "Privacy Notice - Processing of Your Personal Data (GDPR).pdf",
]

SYSTEM = """You are an expert at reading international/expat HEALTH INSURANCE policy
documents (here: APRIL International "Ma Santé International"). Your job is to extract
EVERY precise, actionable rule a reimbursement engine would need — exhaustively and
WITHOUT inventing anything.

Hard rules:
- For every benefit/limit/percentage/ceiling/waiting-period/exclusion/condition you
  output, include a VERBATIM source_quote copied exactly from the document. Never
  paraphrase the source_quote.
- If a value is not stated, use null. NEVER invent a number, percentage, limit, or date.
- Keep amounts as numbers with their currency. Keep percentages as written.
- Be exhaustive on the Table of Benefits: one entry per benefit line, with its coverage
  basis (e.g. "100%", "80%", "actual costs", annual ceiling), any sub-limit, waiting
  period, and whether pre-authorisation or a prescription/medical certificate is required.
- Capture claim rules: filing deadline / time limit to submit, how to submit, required
  documents, reimbursement currency, territorial scope, deductible/excess.
Return STRICT JSON only, matching the requested shape."""

SHAPE = """Return JSON with this exact shape (use null / [] when not present):
{
 "doc_type": "table_of_benefits | general_conditions | certificate | member_guide | ipid | medical_certificate_form | privacy_notice | other",
 "doc_title": string,
 "summary": string,                         // 2-3 sentences: what this document is + its role
 "policy_identity": {                       // fill what THIS doc states
   "insurer": string|null, "product_name": string|null, "policy_number": string|null,
   "currency": string|null, "territorial_scope": string|null,
   "premium": string|null, "premium_frequency": string|null,
   "reimbursement_iban": string|null, "intermediary": string|null,
   "members": [ {"name": string, "date_of_birth": string|null} ]
 },
 "benefits": [                              // the precise coverage rules (esp. Table of Benefits)
   {"category": string, "benefit_name": string, "coverage_basis": string|null,
    "annual_limit": string|null, "sub_limit": string|null, "per_unit_limit": string|null,
    "waiting_period": string|null, "requires_preauth": boolean|null,
    "requires_prescription_or_certificate": boolean|null,
    "conditions": string|null, "source_quote": string}
 ],
 "waiting_periods": [ {"item": string, "duration": string, "source_quote": string} ],
 "exclusions": [ {"text": string, "source_quote": string} ],
 "claim_rules": {
   "filing_deadline": string|null, "how_to_submit": string|null,
   "required_documents": [string], "reimbursement_currency": string|null,
   "deductible_or_excess": string|null, "source_quote": string|null
 },
 "other_rules": [ {"topic": string, "rule": string, "source_quote": string} ],
 "extraction_confidence": "high | medium | low",
 "unreadable_or_uncertain": [string]        // anything you could not read clearly
}"""


def token() -> str:
    # shell=True so Windows resolves gcloud.cmd via PATH
    return subprocess.run(
        "gcloud auth print-access-token",
        shell=True,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def extract(pdf: Path, tok: str) -> dict:
    data = base64.b64encode(pdf.read_bytes()).decode()
    url = (
        f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}"
        f"/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent"
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": "application/pdf", "data": data}},
                    {
                        "text": f"Read this document ('{pdf.name}') and extract it.\n\n{SHAPE}"
                    },
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
            "maxOutputTokens": 60000,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        out = json.loads(resp.read())
    parts = out["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts)
    return json.loads(text)


def summarize(name: str, d: dict):
    print(f"\n{'=' * 70}\n{name}\n{'=' * 70}")
    print(
        f"  doc_type: {d.get('doc_type')}   confidence: {d.get('extraction_confidence')}"
    )
    print(f"  summary:  {(d.get('summary') or '')[:200]}")
    pid = d.get("policy_identity") or {}
    if pid.get("product_name") or pid.get("policy_number"):
        print(
            f"  policy:   {pid.get('product_name')} · {pid.get('policy_number')} · {pid.get('currency')} · {pid.get('territorial_scope')}"
        )
    if pid.get("members"):
        print(f"  members:  {', '.join(m.get('name', '?') for m in pid['members'])}")
    benefits = d.get("benefits") or []
    if benefits:
        print(f"  BENEFITS ({len(benefits)}):")
        for b in benefits[:40]:
            lim = " · ".join(
                x
                for x in [
                    b.get("coverage_basis"),
                    b.get("annual_limit"),
                    b.get("sub_limit"),
                    b.get("waiting_period"),
                ]
                if x
            )
            print(
                f"    - {b.get('category', '')[:22]:22s} {b.get('benefit_name', '')[:34]:34s} {lim}"
            )
        if len(benefits) > 40:
            print(f"    ... +{len(benefits) - 40} more")
    if d.get("waiting_periods"):
        wp = "; ".join(
            f"{w.get('item')}={w.get('duration')}" for w in d["waiting_periods"][:8]
        )
        print(f"  WAITING PERIODS ({len(d['waiting_periods'])}): {wp}")
    if d.get("exclusions"):
        print(f"  EXCLUSIONS: {len(d['exclusions'])}")
    cr = d.get("claim_rules") or {}
    if cr.get("filing_deadline") or cr.get("how_to_submit"):
        print(
            f"  CLAIM: deadline={cr.get('filing_deadline')} · currency={cr.get('reimbursement_currency')} · excess={cr.get('deductible_or_excess')}"
        )
        if cr.get("required_documents"):
            print(f"         required docs: {', '.join(cr['required_documents'][:6])}")
    if d.get("unreadable_or_uncertain"):
        print(f"  ⚠ UNCERTAIN: {'; '.join(d['unreadable_or_uncertain'][:5])}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if "--all" in args:
        files = [DOWNLOADS / n for n in APRIL_DOCS]
    else:
        files = [Path(a) for a in args if not a.startswith("--")]
    if not files:
        print("Usage: ingest_policy_docs.py <pdf>...  |  --all")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tok = token()
    for pdf in files:
        if not pdf.exists():
            print(f"  MISSING: {pdf}")
            continue
        try:
            d = extract(pdf, tok)
        except urllib.error.HTTPError as e:
            print(f"  ERROR {pdf.name}: {e.code} {e.read().decode()[:400]}")
            continue
        out = OUT_DIR / (pdf.stem.replace(" ", "_") + ".json")
        out.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        summarize(pdf.name, d)
        print(f"  → saved {out.relative_to(OUT_DIR.parent.parent.parent)}")


if __name__ == "__main__":
    main()
