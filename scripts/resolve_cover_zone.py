"""
Resolve the APRIL "Ma Santé Internationale" Cover Zone definitions from the
General Conditions PDF. Pins exactly which countries each zone covers, the
real overall annual limits per zone/plan, and any high-cost-country caps.

Goal for our family (Premium, Zone 2, living in Brazil):
  - Confirm Brazil falls inside Zone 2 (proof, not assumption)
  - Replace 'unlimited' overall_annual_limit assumption with the actual Premium value
  - Capture high-cost-country caps (USA, Japan, etc.) for Premium

Run:
    python -X utf8 scripts/resolve_cover_zone.py            (dry-run, prints + JSON)
    python -X utf8 scripts/resolve_cover_zone.py --apply    (also updates the policy in DB)
"""

import sys
import json
import base64
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest_policy_docs import token, PROJECT, LOCATION, MODEL  # noqa: E402
from _nf_db import client, fetch_all  # noqa: E402

APPLY = "--apply" in sys.argv
GC_PDF = Path.home() / "Downloads" / "General Conditions.pdf"
OUT = (
    Path(__file__).parent.parent
    / "docs"
    / "health-hub"
    / "extracted"
    / "cover_zones.json"
)

SYSTEM = """You are reading the APRIL International "Ma Santé Internationale / MyHealth
International" General Conditions document. Extract the COVER ZONE map: which countries
or country groups belong to each zone (0, 1, 2, 3, 4, 5), AND the per-zone overall
annual limits for the PREMIUM plan. Also extract any high-cost-country caps (e.g. USA,
Japan, Singapore, Puerto Rico, Bahamas) that override the worldwide overall limit.

Rules:
- Every zone entry MUST include a verbatim source_quote from the document.
- If the document does not explicitly list the countries in Zone 2 (etc.), set the
  countries array to [] and explain in notes. NEVER invent country lists.
- Brazil's classification: explicitly identify which zone Brazil belongs to, with quote.
Return STRICT JSON only."""

SHAPE = """JSON shape:
{
 "zones": [
   {"zone":"0|1|2|3|4|5", "countries":[string], "label": string|null,
    "premium_overall_annual_limit": string|null, "notes": string|null,
    "source_quote": string}
 ],
 "brazil": {"zone": string|null, "source_quote": string|null, "notes": string|null},
 "high_cost_country_caps": [
   {"countries":[string], "premium_limit": string, "source_quote": string}
 ],
 "extraction_confidence":"high|medium|low",
 "uncertain":[string]
}"""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = base64.b64encode(GC_PDF.read_bytes()).decode()
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
                        "text": "Extract the Cover Zone definitions and overall limits.\n\n"
                        + SHAPE
                    },
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
            "maxOutputTokens": 50000,
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

    print(f"Confidence: {d.get('extraction_confidence')}")
    print()
    for z in d.get("zones", []) or []:
        ct = ", ".join((z.get("countries") or [])[:8]) or "(no country list extracted)"
        if len(z.get("countries") or []) > 8:
            ct += f", +{len(z['countries']) - 8} more"
        print(f"Zone {z.get('zone')}: limit={z.get('premium_overall_annual_limit')}")
        print(f"  countries: {ct}")
        if z.get("source_quote"):
            print(f'  ↳ "{z["source_quote"][:160]}"')
    print()
    brazil = d.get("brazil") or {}
    print(f"BRAZIL → zone {brazil.get('zone')}")
    if brazil.get("source_quote"):
        print(f'  ↳ "{brazil["source_quote"][:200]}"')
    if brazil.get("notes"):
        print(f"  notes: {brazil['notes']}")
    print()
    caps = d.get("high_cost_country_caps") or []
    if caps:
        print(f"HIGH-COST CAPS ({len(caps)}):")
        for c in caps:
            print(
                f"  {', '.join(c.get('countries') or [])[:60]} → {c.get('premium_limit')}"
            )
    if d.get("uncertain"):
        print("\n⚠ uncertain:", "; ".join(d["uncertain"][:6]))
    print(f"\nsaved → {OUT}")

    if not APPLY:
        print("\nDRY RUN — DB not touched. Re-run with --apply to update the policy.")
        return

    # Apply to DB: set overall_annual_limit for Premium/Zone 2, and add a policy_term
    # that pins the zone definition + the Brazil determination.
    sb = client()
    pol = [
        p
        for p in fetch_all(sb, "insurance_policies")
        if p.get("policy_number") == "APA6000280502"
    ]
    if not pol:
        print("Policy APA6000280502 not in DB — run save_policy_safe.py first")
        return
    pid = pol[0]["id"]

    zone2 = next((z for z in d.get("zones", []) if str(z.get("zone")) == "2"), None)
    new_limit = (zone2 or {}).get("premium_overall_annual_limit")
    brazil_zone = brazil.get("zone")
    brazil_match = brazil_zone is not None and str(brazil_zone) == "2"

    if new_limit:
        sb.from_("insurance_policies").update({"overall_annual_limit": new_limit}).eq(
            "id", pid
        ).execute()
        print(f"  policy overall_annual_limit -> {new_limit}")

    # Replace any prior zone-definition terms to avoid duplicates on re-run
    existing = [
        t
        for t in fetch_all(sb, "policy_terms")
        if t["policy_id"] == pid
        and t["term_type"] == "definition"
        and (t.get("title") or "").startswith("Cover Zone")
    ]
    for t in existing:
        sb.from_("policy_terms").delete().eq("id", t["id"]).execute()

    if zone2:
        sb.from_("policy_terms").insert(
            {
                "policy_id": pid,
                "term_type": "definition",
                "title": "Cover Zone 2 — countries + Premium overall limit",
                "text": f"Countries: {', '.join(zone2.get('countries') or []) or '(not explicitly listed)'}. "
                f"Premium overall annual limit: {zone2.get('premium_overall_annual_limit')}. "
                f"Notes: {zone2.get('notes')}",
                "source_quote": zone2.get("source_quote"),
                "source_document": "General Conditions.pdf",
                "human_confirmed": False,
            }
        ).execute()
        print("  policy_term added: Cover Zone 2 — countries + Premium overall limit")

    if brazil.get("zone") is not None:
        sb.from_("policy_terms").insert(
            {
                "policy_id": pid,
                "term_type": "definition",
                "title": f"Brazil → Zone {brazil['zone']} {'✓ matches our policy' if brazil_match else '⚠ DOES NOT MATCH Zone 2'}",
                "text": brazil.get("notes")
                or f"General Conditions places Brazil in Zone {brazil['zone']}.",
                "source_quote": brazil.get("source_quote"),
                "source_document": "General Conditions.pdf",
                "human_confirmed": False,
            }
        ).execute()
        print(
            f"  policy_term added: Brazil zone = {brazil['zone']}"
            f" ({'OK' if brazil_match else 'MISMATCH — investigate'})"
        )

    for c in caps:
        sb.from_("policy_terms").insert(
            {
                "policy_id": pid,
                "term_type": "definition",
                "title": f"High-cost cap — {', '.join(c.get('countries') or [])[:60]}",
                "text": f"Premium limit: {c.get('premium_limit')}",
                "source_quote": c.get("source_quote"),
                "source_document": "General Conditions.pdf",
                "human_confirmed": False,
            }
        ).execute()
    if caps:
        print(f"  policy_term added: {len(caps)} high-cost-country caps")


if __name__ == "__main__":
    main()
