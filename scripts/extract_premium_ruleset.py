"""
Extract the PRECISE ruleset for the family's actual plan: APRIL "Ma Santé
Internationale" — PREMIUM tier, Cover Zone 2, EUR. Filters the multi-tier Table
of Benefits down to the Premium column with a verbatim source_quote per benefit.

Writes docs/health-hub/extracted/premium_ruleset.json (PII-light: coverage rules
only) and prints it for verification. No DB writes.

    python -X utf8 scripts/extract_premium_ruleset.py
"""

import sys
import json
import base64
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest_policy_docs import token, PROJECT, LOCATION, MODEL  # noqa: E402

TOB = Path.home() / "Downloads" / "Table of Benefits.pdf"
OUT = (
    Path(__file__).parent.parent
    / "docs"
    / "health-hub"
    / "extracted"
    / "premium_ruleset.json"
)

SYSTEM = """You read the APRIL International "Ma Santé Internationale / MyHealth
International" Table of Benefits. The family is on the PREMIUM plan, Cover Zone 2,
currency EUR. Extract the PRECISE coverage for the PREMIUM column ONLY.

Rules:
- One entry per benefit line in the table. Give the PREMIUM plan's value for that
  benefit (not the other tiers). If the value is zone-specific, use Zone 2 / EUR.
- Include benefits that are "not covered" under Premium too (premium_coverage:"not covered").
- Every entry MUST include a verbatim source_quote from the document.
- Never invent a number. If a Premium value is not stated, use null and say so in notes.
Return STRICT JSON only."""

SHAPE = """JSON shape:
{
 "plan":"Premium","cover_zone":"2","currency":"EUR",
 "overall_annual_limit": string|null,
 "deductible": string|null,
 "benefits":[
   {"section": string,            // e.g. Hospitalisation, Outpatient, Dental, Optical, Maternity
    "benefit": string,
    "premium_coverage": string,   // the Premium value: "100%", "up to €X/year", "not covered", etc.
    "annual_limit": string|null, "sub_limit": string|null,
    "waiting_period": string|null,
    "requires_preauth": boolean|null,
    "requires_prescription_or_certificate": boolean|null,
    "notes": string|null,
    "source_quote": string}
 ],
 "extraction_confidence":"high|medium|low",
 "uncertain":[string]
}"""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = base64.b64encode(TOB.read_bytes()).decode()
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
                    {"text": "Extract the PREMIUM plan ruleset.\n\n" + SHAPE},
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
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        out = json.loads(resp.read())
    text = "".join(p.get("text", "") for p in out["candidates"][0]["content"]["parts"])
    d = json.loads(text)
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"PREMIUM ruleset · zone {d.get('cover_zone')} · {d.get('currency')} · "
        f"overall limit {d.get('overall_annual_limit')} · deductible {d.get('deductible')} · "
        f"confidence {d.get('extraction_confidence')}"
    )
    print(f"Benefits: {len(d.get('benefits', []))}\n")
    sec = None
    for b in d.get("benefits", []):
        if b.get("section") != sec:
            sec = b.get("section")
            print(f"── {sec} ──")
        lim = " · ".join(
            x
            for x in [
                b.get("annual_limit"),
                b.get("sub_limit"),
                b.get("waiting_period"),
            ]
            if x
        )
        flags = "".join(
            [
                "P" if b.get("requires_preauth") else "",
                "R" if b.get("requires_prescription_or_certificate") else "",
            ]
        )
        print(
            f"   {b.get('benefit', '')[:46]:46s} {str(b.get('premium_coverage'))[:24]:24s} {lim} {flags}"
        )
    if d.get("uncertain"):
        print("\n⚠ uncertain:", "; ".join(d["uncertain"][:6]))
    print(f"\nsaved → {OUT}")


if __name__ == "__main__":
    main()
