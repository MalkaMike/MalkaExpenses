#!/usr/bin/env python3
"""
Extract structured data from all NFS-e PDFs in private/nota-fiscais/
and insert into the nota_fiscais + nota_fiscal_items tables.

Usage:
  python scripts/extract_nota_fiscais.py [--dry-run] [--file nota_xxx.pdf]

Requirements:
  pip install pdfplumber supabase
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import pdfplumber
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
APP_DIR = SCRIPT_DIR.parent
PDF_DIR = APP_DIR / "private" / "nota-fiscais"
ENV_FILE = APP_DIR / ".env.local"
SECRETS_FILE = Path.home() / ".claude" / "secrets.local.env"


def load_env(*paths):
    env = {}
    for p in paths:
        try:
            for line in Path(p).read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                eq = line.index("=") if "=" in line else -1
                if eq == -1:
                    continue
                key = line[:eq].strip()
                val = line[eq + 1 :].strip().strip("'\"")
                # Unescape bcrypt-style \$ to $
                val = val.replace("\\$", "$")
                env[key] = val
        except FileNotFoundError:
            pass
    return env


ENV = load_env(ENV_FILE, SECRETS_FILE)
SUPABASE_URL = ENV.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

# ── Service code → category mapping ────────────────────────────────────────────

SERVICE_CATEGORY = {
    # Health
    "0401": "saude",
    "04010": "saude",
    "0402": "saude",
    "04020": "saude",
    "0403": "saude",
    "04030": "saude",
    "0404": "saude",
    "04040": "saude",
    "04034": "saude",
    "04037": "saude",
    "04099": "saude",
    "07020": "saude",  # clinical analysis
    # Education
    "0850": "educacao",
    "08506": "educacao",
    "08501": "educacao",
    "08505": "educacao",
    # Beauty / Personal care
    "09512": "outros",
    # Legal / Professional
    "17012": "outros",
    "17011": "outros",
    # Maintenance / home services
    "14013": "moradia",
    # Transportation
    "16001": "transporte",
    "16002": "transporte",
}

MEDICAL_KEYWORDS = {
    "medic",
    "clinica",
    "hospital",
    "saude",
    "health",
    "doutor",
    "dr.",
    "dentist",
    "odontos",
    "fisioter",
    "psicolog",
    "nutri",
    "farmac",
    "laborat",
    "exame",
    "imuniz",
    "vacin",
    "einstein",
    "cedipi",
    "biomedic",
    "ortoped",
    "pediatr",
    "ginecol",
    "cardiol",
    "dermatol",
    "oftalm",
    "neurolog",
    "oncolog",
    "cirurg",
}

EDUCATION_KEYWORDS = {
    "escola",
    "colegio",
    "universidade",
    "faculdade",
    "ensino",
    "educac",
    "curso",
    "treinamento",
    "idioma",
    "ingles",
    "anglob",
    "britanico",
}


def is_medical(provider_name: str, service_code: str, service_desc: str) -> bool:
    combined = (provider_name + " " + service_desc).lower()
    if any(k in combined for k in MEDICAL_KEYWORDS):
        return True
    sc = re.sub(r"[^\d]", "", service_code or "")
    return sc[:2] in {"04", "07"}


def is_education(provider_name: str, service_code: str) -> bool:
    pn = provider_name.lower()
    if any(k in pn for k in EDUCATION_KEYWORDS):
        return True
    sc = re.sub(r"[^\d]", "", service_code or "")
    return sc[:3] == "085"


def guess_category(provider_name: str, service_code: str, service_desc: str) -> str:
    sc = re.sub(r"[^\d]", "", service_code or "")
    for prefix_len in (5, 4, 3, 2):
        cat = SERVICE_CATEGORY.get(sc[:prefix_len])
        if cat:
            return cat
    if is_medical(provider_name, service_code, service_desc):
        return "saude"
    if is_education(provider_name, service_code):
        return "educacao"
    return "outros"


# ── Parsing helpers ─────────────────────────────────────────────────────────────


def norm_amount(s: str) -> float | None:
    """'1.170,00' → 1170.0"""
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def norm_date(s: str) -> str | None:
    """'25/04/2025 10:52:32' or '25/04/2025' → ISO"""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.isoformat()
        except ValueError:
            pass
    return None


def clean_cnpj(s: str) -> str | None:
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return digits if len(digits) in (11, 14) else None


# ── Main extractor ─────────────────────────────────────────────────────────────


def extract_nf(pdf_path: Path) -> dict | None:
    """Returns a dict ready for insertion, or None if extraction fails."""

    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            raw_text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    except Exception as e:
        print(f"  WARN pdfplumber failed: {e}")
        return None

    t = raw_text

    # ── NF number ──────────────────────────────────────────────────────────────
    m = re.search(r"N[úu]mero da Nota\s*\n\s*(\d+)", t)
    if not m:
        # Alternative layout: number appears right after verification line
        m = re.search(r"\n(\d{5,9})\n", t)
    nf_number = m.group(1).lstrip("0") if m else pdf_path.stem.split("_")[-1]

    # ── Emission date ──────────────────────────────────────────────────────────
    m = re.search(
        r"Data e Hora de Emiss[ãa]o\s*\n\s*(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})", t
    )
    if not m:
        m = re.search(r"(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})", t)
    emission_date = norm_date(m.group(1)) if m else None

    # ── Verification code ──────────────────────────────────────────────────────
    m = re.search(
        r"C[óo]digo de Verifica[çc][ãa]o\s*\n\s*(?:RPS[^\n]+\n\s*)?([A-Z0-9]{4}-[A-Z0-9]{4})",
        t,
    )
    if not m:
        m = re.search(r"\b([A-Z0-9]{4}-[A-Z0-9]{4})\b", t)
    verification_code = m.group(1) if m else None

    # ── RPS ────────────────────────────────────────────────────────────────────
    m = re.search(r"RPS N[º°o]\s*(\d+)\s+S[ée]rie\s+([A-Z0-9]+)", t)
    rps_number = m.group(1) if m else None
    rps_serie = m.group(2) if m else None

    m = re.search(r"emitido em (\d{2}/\d{2}/\d{4})", t)
    rps_date = norm_date(m.group(1))[:10] if m else None

    # ── National ID ────────────────────────────────────────────────────────────
    m = re.search(r"Identificador Nacional:\s*(\d+)", t)
    national_id = m.group(1) if m else None

    # ── Provider ───────────────────────────────────────────────────────────────
    # Look in PRESTADOR section
    prestador_block = re.search(
        r"PRESTADOR DE SERVI[ÇC]OS(.*?)(?:TOMADOR DE SERVI[ÇC]OS|INTERMEDI[ÁA]RIO)",
        t,
        re.DOTALL,
    )
    block = prestador_block.group(1) if prestador_block else t

    m = re.search(
        r"CPF/CNPJ:\s*([\d./-]+)\s+Inscri[çc][ãa]o Municipal:\s*([\d.-]+)", block
    )
    if not m:
        m = re.search(r"([\d]{2,3}\.[\d]{3}\.[\d]{3}/[\d]{4}-[\d]{2})", block)
    provider_cnpj_raw = m.group(1).strip() if m else None
    provider_municipal_reg = (
        m.group(2).strip() if (m and m.lastindex and m.lastindex >= 2) else None
    )

    m = re.search(r"Nome/Raz[ãa]o Social:\s*\n?\s*(.+?)(?:\n|Endere[çc]o:)", block)
    provider_name = m.group(1).strip() if m else None
    if not provider_name:
        # Sometimes name is inline after CNPJ block
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        for i, line in enumerate(lines):
            if "CPF/CNPJ" in line or "Inscri" in line:
                # Name usually follows a few lines later
                for j in range(i + 1, min(i + 5, len(lines))):
                    if re.match(
                        r"[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-Za-záéíóúàâêôãõç\s\-./]+", lines[j]
                    ):
                        if not re.match(r"^\d", lines[j]) and len(lines[j]) > 5:
                            provider_name = lines[j]
                            break
                if provider_name:
                    break

    m = re.search(r"Endere[çc]o:\s*(.+?)(?:\n|Munic[íi]pio:)", block)
    provider_address = m.group(1).strip() if m else None

    m = re.search(r"Munic[íi]pio:\s*(.+?)\s+UF:\s*([A-Z]{2})", block)
    provider_city = m.group(1).strip() if m else None
    provider_state = m.group(2).strip() if m else None

    provider_cnpj = clean_cnpj(provider_cnpj_raw)

    # ── Service ────────────────────────────────────────────────────────────────
    m = re.search(
        r"DISCRIMINA[ÇC][ÃA]O DE SERVI[ÇC]OS\s*\n(.*?)(?:Carga tribut|VALOR TOTAL|C[óo]digo do Servi|Contribui[çc][ãa]o)",
        t,
        re.DOTALL,
    )
    service_description = m.group(1).strip() if m else None

    m = re.search(r"C[óo]digo do Servi[çc]o\s*\n\s*(\d{2,5})\s*[-–]\s*(.+?)(?:\n|$)", t)
    service_code = m.group(1) if m else None
    service_code_desc = m.group(2).strip().rstrip(".") if m else None

    # ── Patient ────────────────────────────────────────────────────────────────
    m = re.search(
        r"[Pp]aciente:\s*([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-Za-záéíóúàâêôãõç\s]+?)\.?(?:\n|$)", t
    )
    patient_name = m.group(1).strip() if m else None

    # ── Total amount ───────────────────────────────────────────────────────────
    m = re.search(r"VALOR TOTAL DO SERVI[ÇC]O\s*=\s*R\$\s*([\d.,]+)", t)
    total_amount = norm_amount(m.group(1)) if m else None

    if total_amount is None:
        # Fallback: largest amount in document
        amounts = re.findall(r"R\$\s*([\d.]+,\d{2})", t)
        parsed = [norm_amount(a) for a in amounts if norm_amount(a)]
        total_amount = max(parsed) if parsed else 0.0

    # ── ISS ────────────────────────────────────────────────────────────────────
    m = re.search(r"Al[íi]quota\s*\(%\)\s*([\d,]+)%", t)
    if not m:
        m = re.search(r"([\d,]+)%\s+[\d.,]+\s+[\d.,]+\s*$", t, re.MULTILINE)
    iss_rate_str = m.group(1).replace(",", ".") if m else None
    iss_rate = float(iss_rate_str) / 100 if iss_rate_str else None

    m = re.search(r"Valor do ISS\s*\(R\$\)\s*([\d.,]+)", t)
    iss_amount = norm_amount(m.group(1)) if m else None

    # ── Deductions / base ──────────────────────────────────────────────────────
    m = re.search(r"Valor Total das Dedu[çc][õo]es\s*\(R\$\)\s*([\d.,]+)", t)
    deductions = norm_amount(m.group(1)) if m else None

    m = re.search(r"Base de C[áa]lculo\s*\(R\$\)\s*([\d.,]+)", t)
    base_calculation = norm_amount(m.group(1)) if m else None

    # ── Retentions ─────────────────────────────────────────────────────────────
    m = re.search(r"IRRF\s*\(R\$\)\s*([\d.,]+)", t)
    ir_retained = norm_amount(m.group(1)) if m else None

    m = re.search(r"COFINS\s*\(R\$\)\s*([\d.,]+)", t)
    cofins_retained = norm_amount(m.group(1)) if m else None

    m = re.search(r"PIS/PASEP\s*\(R\$\)\s*([\d.,]+)", t)
    pis_retained = norm_amount(m.group(1)) if m else None

    m = re.search(r"Contribui[çc][ãa]o Previdenci[áa]ria[^(]+\(R\$\)\s*([\d.,]+)", t)
    inss_retained = norm_amount(m.group(1)) if m else None

    # ── Payment date ───────────────────────────────────────────────────────────
    m = re.search(r"quitada em (\d{2}/\d{2}/\d{4})", t)
    payment_date = norm_date(m.group(1))[:10] if m else None

    # ── Municipal registration ─────────────────────────────────────────────────
    if not provider_municipal_reg:
        m = re.search(r"Inscri[çc][ãa]o Municipal:\s*([\d.-]+)", t)
        provider_municipal_reg = m.group(1).strip() if m else None

    # ── Line items ─────────────────────────────────────────────────────────────
    items = []
    if service_description:
        for item_m in re.finditer(
            r"[-•]\s+(.+?)\s*\(R\$\s*([\d.,]+)\)", service_description
        ):
            desc = item_m.group(1).strip()
            amt = norm_amount(item_m.group(2))
            items.append({"description": desc, "amount": amt})

    # ── Classification ─────────────────────────────────────────────────────────
    pname = provider_name or ""
    sdesc = service_description or ""
    sc = service_code or ""
    category = guess_category(pname, sc, sdesc)
    medical = is_medical(pname, sc, sdesc)
    education_flag = is_education(pname, sc)

    return {
        "file_name": pdf_path.name,
        "file_path": f"/private/nota-fiscais/{pdf_path.name}",
        "source_type": "pdf_folder",
        "nf_number": nf_number,
        "rps_number": rps_number,
        "rps_serie": rps_serie,
        "rps_date": rps_date,
        "national_id": national_id,
        "verification_code": verification_code,
        "municipal_registration": provider_municipal_reg,
        "provider_cnpj": provider_cnpj,
        "provider_cnpj_formatted": provider_cnpj_raw,
        "provider_name": provider_name or "UNKNOWN",
        "provider_address": provider_address,
        "provider_city": provider_city,
        "provider_state": provider_state,
        "recipient_cpf": "23304126813",
        "recipient_name": "MICKAEL ISRAEL MALKA",
        "service_code": service_code,
        "service_description": service_description,
        "patient_name": patient_name,
        "total_amount": total_amount or 0.0,
        "deductions": deductions,
        "base_calculation": base_calculation,
        "iss_rate": iss_rate,
        "iss_amount": iss_amount,
        "ir_retained": ir_retained,
        "cofins_retained": cofins_retained,
        "pis_retained": pis_retained,
        "inss_retained": inss_retained,
        "emission_date": emission_date,
        "rps_date": rps_date,
        "payment_date": payment_date,
        "category_slug": category,
        "is_medical": medical,
        "is_education": education_flag,
        "is_reimbursable": medical,
        "reimbursement_status": "not_submitted",
        "raw_text": raw_text,
        "_items": items,  # not a DB column — extracted separately
    }


# ── Transaction matching ────────────────────────────────────────────────────────


def find_matching_transaction(sb, nf: dict) -> tuple[str | None, str]:
    """Returns (transaction_id, confidence) or (None, 'none').

    Matches by: amount within 2% AND emission_date within ±30 days.
    Picks the closest date match among candidates.
    NFs are always negative (expenses) so we look for negative real_amount.
    """
    if not nf.get("emission_date") or not nf.get("total_amount"):
        return None, "none"

    amount = nf["total_amount"]
    emission_date = nf["emission_date"][:10]

    from datetime import date, timedelta

    center = date.fromisoformat(emission_date)
    date_from = (center - timedelta(days=30)).isoformat()
    date_to = (center + timedelta(days=30)).isoformat()

    # Amount tolerance: ±2%
    tol = amount * 0.02
    amt_min = -(amount + tol)  # expenses are negative in the ledger
    amt_max = -(amount - tol)

    resp = (
        sb.table("transactions")
        .select("id, date, real_amount, description_clean")
        .gte("date", date_from)
        .lte("date", date_to)
        .gte("real_amount", amt_min)
        .lte("real_amount", amt_max)
        .eq("is_fake", False)
        .is_("reconciled_with_transaction_id", "null")
        .execute()
    )

    candidates = resp.data or []
    if not candidates:
        return None, "none"

    # Pick candidate with date closest to emission_date
    def date_distance(row):
        try:
            return abs((date.fromisoformat(row["date"]) - center).days)
        except Exception:
            return 999

    best = min(candidates, key=date_distance)
    distance = date_distance(best)

    if distance == 0:
        confidence = "verified"
    elif distance <= 3:
        confidence = "high"
    else:
        confidence = "medium"

    return best["id"], confidence


# ── Main ────────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run", action="store_true", help="Extract but don't insert"
    )
    parser.add_argument("--file", help="Process only this filename (for testing)")
    parser.add_argument(
        "--skip-matching", action="store_true", help="Skip transaction matching"
    )
    args = parser.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Get already-processed filenames to skip
    existing = sb.table("nota_fiscais").select("file_name").execute()
    already_done = {r["file_name"] for r in (existing.data or [])}
    print(f"Already in DB: {len(already_done)}")

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if args.file:
        pdfs = [p for p in pdfs if p.name == args.file]

    inserted = 0
    skipped = 0
    errors = 0

    for pdf_path in pdfs:
        if pdf_path.name in already_done:
            skipped += 1
            continue

        print(f"Processing {pdf_path.name}...", end=" ", flush=True)

        nf = extract_nf(pdf_path)
        if not nf:
            print("FAILED")
            errors += 1
            continue

        items = nf.pop("_items", [])

        if args.dry_run:
            print(
                f"DRY  provider={nf['provider_name']!r} amount={nf['total_amount']} cat={nf['category_slug']}"
            )
            continue

        # Insert nota fiscal
        try:
            result = sb.table("nota_fiscais").insert(nf).execute()
            nf_id = result.data[0]["id"]
        except Exception as e:
            print(f"INSERT ERROR: {e}")
            errors += 1
            continue

        # Insert line items
        for i, item in enumerate(items):
            try:
                sb.table("nota_fiscal_items").insert(
                    {
                        "nota_fiscal_id": nf_id,
                        "description": item["description"],
                        "amount": item["amount"],
                        "sort_order": i,
                    }
                ).execute()
            except Exception as e:
                print(f"  item insert warn: {e}")

        # Transaction matching (best-effort)
        if not args.skip_matching and nf.get("emission_date"):
            try:
                tx_id, confidence = find_matching_transaction(sb, nf)
                if tx_id:
                    sb.table("nota_fiscais").update(
                        {
                            "transaction_id": tx_id,
                            "match_confidence": confidence,
                            "match_source": "amount+date",
                        }
                    ).eq("id", nf_id).execute()
                    print(
                        f"OK  provider={nf['provider_name']!r} amount={nf['total_amount']} → matched tx ({confidence})"
                    )
                else:
                    print(
                        f"OK  provider={nf['provider_name']!r} amount={nf['total_amount']} cat={nf['category_slug']}"
                    )
            except Exception as e:
                # Matching is best-effort; don't fail the insert
                print(f"OK  (match warn: {e})")
        else:
            print(
                f"OK  provider={nf['provider_name']!r} amount={nf['total_amount']} cat={nf['category_slug']}"
            )

        inserted += 1

    print(f"\nDone. inserted={inserted} skipped={skipped} errors={errors}")


if __name__ == "__main__":
    main()
