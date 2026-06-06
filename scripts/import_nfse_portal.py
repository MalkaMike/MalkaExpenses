"""
Import NFS-e records from the São Paulo NFS-e portal CSV export into nota_fiscais.

Usage:
    python -X utf8 scripts/import_nfse_portal.py <csv_path> [--dry-run]

The CSV is exported from:
    https://nfe.prefeitura.sp.gov.br/tomador/notasrecapuradas.aspx
    Format: "Planilha (CSV)", Layout V.004
    Encoding: latin-1 (ISO-8859-1)

source_type = 'nfse_portal' for all rows inserted by this script.
Idempotent: skips rows already in DB (matched by file_name).
"""

import csv
import re
import sys
import os
from datetime import datetime
from pathlib import Path

# ── Resolve project root and .env.local ────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent


def _load_env():
    env_path = PROJECT_ROOT / ".env.local"
    result = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                result[k.strip()] = v.strip()
    return result


_env = _load_env()
SUPABASE_URL = _env.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = _env.get("SUPABASE_SERVICE_ROLE_KEY", "")

# ── Service code → category mapping ───────────────────────────────────────────
# Based on the SP municipal service list (LC 116/2003).
MEDICAL_CODES = {
    "4030",  # Médicos
    "4040",  # Enfermeiros
    "4050",  # Biólogos
    "4060",  # Bioquímicos
    "4070",  # Fisioterapeutas
    "4080",  # Terapeutas ocupacionais
    "4090",  # Fonoaudiólogos
    "4100",  # Nutricionistas
    "4111",  # Clínicas, hospitais
    "4121",  # Laboratórios de análises
    "4211",  # Veterinários
    "4311",  # Dentistas
    "4321",  # Protéticos dentários
    "4331",  # Auxiliares de prótese
    "4391",  # Fisioterapia, terapia ocupacional, atividade física
    "4401",  # Medicina e biomedicina
    "4411",  # Diagnósticos e terapias
    "4421",  # Enfermagem
    "4431",  # Serviços de prótese
    "4472",  # Terapia, acupuntura
    "4731",  # Ortodontia
    "5118",  # Psicologia, psicanálise
}

EDUCATION_CODES = {
    "5657",  # Esportes (counts as education spend for kids)
    "5665",  # Educação tecnológica
    "5673",  # Ensino fundamental, médio e superior
    "5762",  # Educação infantil
    "5657",  # Atividades de lazer educacional
}

LEGAL_CODES = {"3379", "3380", "3381", "3421"}

STREAMING_CODES = {"2966", "2970"}

# ── Patient extraction ─────────────────────────────────────────────────────────
_PATIENT_PATTERNS = [
    re.compile(r"Nome do paciente:\s*([^\|\n\r,]+)", re.IGNORECASE),
    re.compile(r"[Pp]aciente:\s*([^\|\n\r,]+)"),
    re.compile(
        r"Servi[çc]o prestado para o cliente:\s*\d+\s*[-–]\s*([^\|\n\r,]+)",
        re.IGNORECASE,
    ),
    re.compile(r"CPF do paciente:.*?Nome:\s*([^\|\n\r,]+)", re.IGNORECASE),
]


def _extract_patient(desc: str) -> str | None:
    for p in _PATIENT_PATTERNS:
        m = p.search(desc)
        if m:
            name = m.group(1).strip().title()
            # Clean up trailing junk
            name = re.sub(r"\s*CPF.*$", "", name, flags=re.IGNORECASE).strip()
            name = re.sub(r"\s*\|.*$", "", name).strip()
            if 3 < len(name) < 60:
                return name
    return None


def _parse_date(s: str) -> str | None:
    """'05/06/2026 09:45:49' → '2026-06-05'"""
    s = s.strip()
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%d/%m/%Y").strftime("%Y-%m-%d")
    except Exception:
        return None


def _parse_amount(s: str) -> float:
    # BR format: "23.134,41" (period=thousands, comma=decimal)
    return float(s.strip().replace(".", "").replace(",", ".") or "0")


def _categorize(service_code: str, provider: str, desc: str) -> tuple[str, bool, bool]:
    """Returns (category_slug, is_medical, is_reimbursable)."""
    code = service_code.strip()
    prov = provider.upper()
    d = (desc or "").upper()

    if code in MEDICAL_CODES:
        return "saude", True, True
    if code in EDUCATION_CODES:
        return "educacao", False, False
    if code in LEGAL_CODES:
        return "servicos", False, False
    if code in STREAMING_CODES:
        return "assinaturas", False, False

    # Provider-name fallback
    medical_keywords = [
        "MEDIC",
        "CLINICA",
        "HOSPITAL",
        "PSICO",
        "ODONTO",
        "FISIO",
        "TERAP",
        "OFTALM",
        "CARDIO",
        "IMUNIZA",
        "FARMAC",
        "ORTOD",
        "FONOAUD",
        "NUTRI",
        "LABORATOR",
        "FLEURY",
        "EINSTEIN",
        "SABIN",
        "DASA",
        "HERMES PARDINI",
    ]
    if any(kw in prov for kw in medical_keywords):
        return "saude", True, True

    # Beauty/personal-care exclusion must come before edu to prevent "INSTITUTO DE BELEZA" mismatch
    beauty_keywords = [
        "BELEZA",
        "CABELEI",
        "NAIL",
        "MAQUIAGEM",
        "MAQUIADORA",
        "ESTETICA",
    ]
    if any(kw in prov for kw in beauty_keywords):
        return "outros", False, False

    edu_keywords = [
        "EDUCAC",
        "ESCOLA",
        "COLEGIO",
        "ENSINO",
        "FUNDACAO",
        "ACADEMIA",
        "BALLET",
        "DANCA",
        "ESPORTES",
    ]
    if any(kw in prov for kw in edu_keywords):
        return "educacao", False, False

    return "outros", False, False


# ── Transaction matching (reuse logic from extract_nota_fiscais.py) ────────────
def _find_tx(
    sb, date_str: str, amount: float, exclude_ids: set
) -> tuple[str | None, str | None]:
    """Search ±15 days for a matching transaction; return (tx_id, confidence)."""
    if not date_str or amount <= 0:
        return None, None

    from datetime import timedelta

    try:
        center = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None, None

    d_from = (center - timedelta(days=15)).strftime("%Y-%m-%d")
    d_to = (center + timedelta(days=15)).strftime("%Y-%m-%d")

    res = (
        sb.from_("transactions")
        .select("id, date, description_clean, real_amount")
        .gte("date", d_from)
        .lte("date", d_to)
        .lt("real_amount", 0)
        .eq("is_fake", False)
        .execute()
    )
    candidates = res.data or []

    def installment_total(desc: str, raw: float) -> float:
        m = re.search(r"\b(\d{1,2})/(\d{2})\b", desc or "")
        if m and int(m.group(2)) > 1:
            return round(abs(raw) * int(m.group(2)), 2)
        return abs(raw)

    scored = []
    for tx in candidates:
        if tx["id"] in exclude_ids:
            continue
        total = installment_total(
            tx["description_clean"] or "", float(tx["real_amount"])
        )
        delta = abs((datetime.strptime(tx["date"], "%Y-%m-%d") - center).days)
        scored.append((delta, -total, tx["id"], total))

    if not scored:
        return None, None

    scored.sort()
    _, _, best_id, best_total = scored[0]
    delta = scored[0][0]

    # Only match if within ±20% of the target amount
    if best_total < amount * 0.5 or best_total > amount * 2.5:
        return None, None

    conf = "high" if delta <= 1 else "medium" if delta <= 7 else "low"
    return best_id, conf


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    dry_run = "--dry-run" in sys.argv

    csv_files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not csv_files:
        # Default: most recent NFSe CSV in Downloads
        dl = Path.home() / "Downloads"
        candidates = sorted(
            dl.glob("NFSe_*.csv"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if not candidates:
            print(
                "Usage: python -X utf8 scripts/import_nfse_portal.py <csv_path> [--dry-run]"
            )
            sys.exit(1)
        csv_files = [str(candidates[0])]

    csv_path = csv_files[0]
    print(f"Input:  {csv_path}")
    print(f"Mode:   {'DRY RUN' if dry_run else 'LIVE INSERT'}")
    print()

    from supabase import create_client

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Pre-fetch existing file_names for dedup
    existing = sb.from_("nota_fiscais").select("file_name").execute()
    existing_names = {r["file_name"] for r in (existing.data or [])}
    print(f"Already in DB: {len(existing_names)} records")

    # Load CSV
    rows = []
    with open(csv_path, encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter=";")
        for r in reader:
            rows.append(r)
    print(f"CSV rows: {len(rows)}")
    print()

    inserted = 0
    skipped = 0
    claimed_tx_ids: set[str] = set()

    for r in rows:
        nf_number = r["Nº NFS-e"].strip()
        verif_code = r["Código de Verificação da NFS-e"].strip()
        fname = f"nfse_portal_{nf_number}_{verif_code}.json"

        if fname in existing_names:
            skipped += 1
            continue

        provider_raw = (r.get("Razão Social do Prestador") or "").strip()
        if not provider_raw or not nf_number:
            # Skip summary/footer rows the portal sometimes appends
            skipped += 1
            continue

        emission_date = _parse_date(r["Data Hora NFE"])
        provider_cnpj = r["CPF/CNPJ do Prestador"].strip()
        svc_code = r["Código do Serviço Prestado na Nota Fiscal"].strip()
        desc = (r.get("Discriminação dos Serviços") or "").strip()
        amount = _parse_amount(r["Valor dos Serviços"])
        situacao = r["Situação da Nota Fiscal"].strip()  # T=normal, C=canceled

        if situacao == "C":
            # Skip canceled NFs
            skipped += 1
            continue

        category, is_medical, is_reimb = _categorize(svc_code, provider_raw, desc)
        patient = _extract_patient(desc)

        # Format CNPJ/CPF
        cnpj_clean = re.sub(r"[^\d]", "", provider_cnpj)
        if len(cnpj_clean) == 14:
            cfmt = f"{cnpj_clean[:2]}.{cnpj_clean[2:5]}.{cnpj_clean[5:8]}/{cnpj_clean[8:12]}-{cnpj_clean[12:]}"
        elif len(cnpj_clean) == 11:
            cfmt = (
                f"{cnpj_clean[:3]}.{cnpj_clean[3:6]}.{cnpj_clean[6:9]}-{cnpj_clean[9:]}"
            )
        else:
            cfmt = provider_cnpj

        # Transaction matching (only for medical/reimbursable)
        tx_id, tx_conf = None, None
        if is_reimb and amount > 0:
            tx_id, tx_conf = _find_tx(sb, emission_date or "", amount, claimed_tx_ids)
            if tx_id:
                claimed_tx_ids.add(tx_id)

        record = {
            "file_name": fname,
            "source_type": "nfse_portal",
            "nf_number": nf_number,
            "emission_date": emission_date,
            "provider_name": provider_raw,
            "provider_cnpj_formatted": cfmt,
            "patient_name": patient,
            "service_code": svc_code,
            "service_description": desc[:500] if desc else None,
            "total_amount": amount,
            "category_slug": category,
            "is_medical": is_medical,
            "is_reimbursable": is_reimb,
            "verification_code": verif_code if verif_code else None,
            "match_confidence": tx_conf if tx_id else "none",
            "transaction_id": tx_id,
            "raw_text": ";".join(v or "" for v in r.values())[:2000],
        }

        tx_info = f"tx={tx_id[:8] if tx_id else 'none'} conf={tx_conf or 'none'}"
        print(
            f"{'[DRY]' if dry_run else 'OK  '} {provider_raw[:40]:40s} | {category:12s} | R${amount:>9.2f} | {patient or '':20s} | {tx_info}"
        )

        if not dry_run:
            sb.from_("nota_fiscais").insert(record).execute()
            existing_names.add(fname)
            inserted += 1

    print()
    print(f"Done. inserted={inserted} skipped={skipped} (dry_run={dry_run})")


if __name__ == "__main__":
    main()
