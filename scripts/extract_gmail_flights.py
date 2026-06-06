#!/usr/bin/env python3
"""
Insert Gmail-sourced airline trip records into nota_fiscais + nota_fiscal_flights.

All flight data was manually extracted from Gmail threads in a prior research
session (session 3a61d2f3, 2026-06-05/06). This script is idempotent — it skips
records with file_name already in the DB.

Usage:
  python scripts/extract_gmail_flights.py [--dry-run]
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

from supabase import create_client

# ── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
APP_DIR = SCRIPT_DIR.parent
ENV_FILE = APP_DIR / ".env.local"
SECRETS = Path.home() / ".claude" / "secrets.local.env"


def load_env(*paths):
    env = {}
    for p in paths:
        try:
            for line in Path(p).read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"").replace("\\$", "$")
        except FileNotFoundError:
            pass
    return env


ENV = load_env(ENV_FILE, SECRETS)
SUPABASE_URL = ENV.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

# ── Flight data ──────────────────────────────────────────────────────────────
#
# Each entry becomes ONE row in nota_fiscais + N rows in nota_fiscal_flights.
# total_amount is left None here — filled in by transaction matching below.
# emission_date = purchase/booking date (when Mickael bought the ticket).
#
# Note on Miami: ticket was purchased Dec 27 2024 and then CANCELED with
# full refund in March 2025. The outbound was reprogrammed to May 6 (LA8194).
# We still insert it so the purchase transaction can be linked.

TRIPS = [
    # ── 1. Miami (CANCELED) ─────────────────────────────────────────────────
    {
        "file_name": "gmail_flight_UZMYQX.json",
        "file_path": "gmail/flights/gmail_flight_UZMYQX.json",
        "nf_number": "UZMYQX",
        "emission_date": "2024-12-27T13:54:59Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea GRU→MIA (CANCELADO - reembolso solicitado em março/2025). "
            "Código de reserva: UZMYQX. Compra: LA9577847HCXV. "
            "Voo reprogramado para LA8194 em 06/05/2025. Passageiros: MICKAEL, AYELET."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "19408662bef4ae34",
        "gmail_message_id": "19408662bef4ae34",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "GRU",
                "dest_city": "Miami",
                "dest_airport": "MIA",
                "departure_date": "2025-05-06",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": "LA8194",
                "booking_ref": "UZMYQX",
                "passengers": ["MICKAEL MALKA", "AYELET MALKA"],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Miami está pronta! "
            "Nº de compra: LA9577847HCXV. Código de reserva: UZMYQX. "
            "Passageiros: MICKAEL, AYELET. "
            "Voo reprogramado LA8190 (05/05) → LA8194 (06/05/2025). "
            "CANCELADO — reembolso solicitado em março/2025."
        ),
    },
    # ── 2. Paris March 2025 ─────────────────────────────────────────────────
    # Outbound date estimated ~27/03 (voucher issued 26/03, return boarded 30/03)
    {
        "file_name": "gmail_flight_CTUZTQ.json",
        "file_path": "gmail/flights/gmail_flight_CTUZTQ.json",
        "nf_number": "CTUZTQ",
        "emission_date": "2025-03-24T17:41:37Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea GRU→CDG→GRU. Código de reserva: CTUZTQ. "
            "Compra: LA9570687QYED. Partida estimada: 27/03/2025. "
            "Retorno confirmado: 30/03/2025 (LA8067). Passageiro: MICKAEL MALKA."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "195c93eefaf85852",
        "gmail_message_id": "195c93eefaf85852",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "GRU",
                "dest_city": "Paris",
                "dest_airport": "CDG",
                "departure_date": "2025-03-27",
                "departure_time": "18:10",
                "airline": "LATAM",
                "flight_number": "LA8068",
                "booking_ref": "CTUZTQ",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Paris",
                "origin_airport": "CDG",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2025-03-30",
                "departure_time": "13:15",
                "airline": "LATAM",
                "flight_number": "LA8067",
                "booking_ref": "CTUZTQ",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Paris está pronta! "
            "Nº de compra: LA9570687QYED. Código de reserva: CTUZTQ. "
            "GRU→CDG ~27/03/2025 (LA8068). CDG→GRU 30/03/2025 (LA8067). "
            "Passageiro: MICKAEL MALKA."
        ),
    },
    # ── 3. Paris May 2025 ───────────────────────────────────────────────────
    # Full details confirmed from boarding pass emails
    {
        "file_name": "gmail_flight_SXZCGP.json",
        "file_path": "gmail/flights/gmail_flight_SXZCGP.json",
        "nf_number": "SXZCGP",
        "emission_date": "2025-05-08T00:49:54Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea GRU→CDG→GRU. Código de reserva: SXZCGP. "
            "Compra: LA9573668BISK. "
            "Partida: 22/05/2025 18:10 (LA8068, poltrona 15A). "
            "Retorno: 28/05/2025 13:15 (LA8067, poltrona 14L). "
            "Passageiro: MICKAEL MALKA."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "196ad5f83c5458b0",
        "gmail_message_id": "196ad5ed5bcb4889",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "GRU",
                "dest_city": "Paris",
                "dest_airport": "CDG",
                "departure_date": "2025-05-22",
                "departure_time": "18:10",
                "airline": "LATAM",
                "flight_number": "LA8068",
                "booking_ref": "SXZCGP",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": "15A",
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Paris",
                "origin_airport": "CDG",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2025-05-28",
                "departure_time": "13:15",
                "airline": "LATAM",
                "flight_number": "LA8067",
                "booking_ref": "SXZCGP",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": "14L",
            },
        ],
        "raw_text": (
            "LATAM Airlines. Electronic ticket receipt. "
            "Reservation code SXZCGP. Nº de compra: LA9573668BISK. "
            "22 Maio PARIS DE GAULLE FRANCE for MICKAEL MALKA. "
            "GRU→CDG 22/05/2025 18:10 LA8068 Boeing 787-9 Terminal 3 seat 15A. "
            "CDG→GRU 28/05/2025 13:15 LA8067 seat 14L."
        ),
    },
    # ── 4. Tel Aviv June–July 2025 ──────────────────────────────────────────
    # Mickael's ticket: KULZCW / LA9578296ZJHU
    # 2nd passenger ticket: KSZJHU / LA9575715VMOA
    # Outbound confirmed: GRU→TLV 30/06/2025 18:00 LA8072
    # Return: not found in Gmail (no check-in email; estimated ~10 days later)
    {
        "file_name": "gmail_flight_KULZCW.json",
        "file_path": "gmail/flights/gmail_flight_KULZCW.json",
        "nf_number": "KULZCW",
        "emission_date": "2025-06-29T14:24:44Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea GRU→TLV (Tel Aviv). Código de reserva: KULZCW. "
            "Compra: LA9578296ZJHU + LA9575715VMOA (2 passageiros). "
            "Partida confirmada: 30/06/2025 18:00 (LA8072). "
            "Retorno: data não encontrada no email (estimado ~10/07/2025). "
            "Encaminhado para Ayelet (leleva@gmail.com) e Shirley (shirleyapsant@gmail.com)."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "197bc1389927232f",
        "gmail_message_id": "197bc1389927232f",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "GRU",
                "dest_city": "Tel Aviv",
                "dest_airport": "TLV",
                "departure_date": "2025-06-30",
                "departure_time": "18:00",
                "airline": "LATAM",
                "flight_number": "LA8072",
                "booking_ref": "KULZCW",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Tel Aviv",
                "origin_airport": "TLV",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": None,
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": None,
                "booking_ref": "KULZCW",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Tel Aviv está pronta! "
            "Nº de compra: LA9578296ZJHU. Código de reserva: KULZCW. "
            "GRU→TLV 30/06/2025 18:00 LA8072. "
            "2 passageiros: MICKAEL + 1. "
            "Requisitos Tel Aviv: LA9575715VMOA / KSZJHU."
        ),
    },
    # ── 5. Curitiba November 2025 ────────────────────────────────────────────
    # Internal Kenlo booking via Larissa Monteiro
    {
        "file_name": "gmail_flight_DCOLDI.json",
        "file_path": "gmail/flights/gmail_flight_DCOLDI.json",
        "nf_number": "DCOLDI",
        "emission_date": "2025-11-12T17:46:27Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea GRU→CWB→GRU (Curitiba). Código de reserva: DCOLDI. "
            "Compra: LA9574455EEHZ (voucher via Kenlo — Larissa Monteiro). "
            "Partida: 16/11/2025 (domingo). Retorno: 19/11/2025 (quarta). "
            "Hotel: Slaviero Curitiba. Passageiro: MICKAEL MALKA."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "19a792d48cbf1633",
        "gmail_message_id": "19a792d48cbf1633",
        "skip_matching": True,  # Kenlo internal booking — no personal finance transaction
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "GRU",
                "dest_city": "Curitiba",
                "dest_airport": "CWB",
                "departure_date": "2025-11-16",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": None,
                "booking_ref": "DCOLDI",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Curitiba",
                "origin_airport": "CWB",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2025-11-19",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": None,
                "booking_ref": "DCOLDI",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "Vouchers Viagem para Curitiba | 16.11.25 - Mickael Malka. "
            "Larissa Monteiro (Kenlo). Conforme solicitado por Nicolas. "
            "Código de reserva DCOLDI. Compra LA9574455EEHZ. "
            "Passagem aérea 16/11 (domingo) → 19/11 (quarta). "
            "Hotel Slaviero Curitiba."
        ),
    },
    # ── 6a. Porto Seguro — MJPTZK (1 pax, comprado 11/11/2025) ─────────────
    {
        "file_name": "gmail_flight_MJPTZK.json",
        "file_path": "gmail/flights/gmail_flight_MJPTZK.json",
        "nf_number": "MJPTZK",
        "emission_date": "2025-11-11T23:53:15Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea CGH→BPS→GRU (Porto Seguro). Código de reserva: MJPTZK. "
            "Compra: LA9571272YJSA. "
            "Partida: 25/12/2025 08:30 CGH (LA3192). "
            "Retorno: 08/01/2026 BPS→GRU (LA4716). 1 passageiro."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "19a755699de444c8",
        "gmail_message_id": "19a755699de444c8",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "CGH",
                "dest_city": "Porto Seguro",
                "dest_airport": "BPS",
                "departure_date": "2025-12-25",
                "departure_time": "08:30",
                "airline": "LATAM",
                "flight_number": "LA3192",
                "booking_ref": "MJPTZK",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Porto Seguro",
                "origin_airport": "BPS",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2026-01-08",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": "LA4716",
                "booking_ref": "MJPTZK",
                "passengers": ["MICKAEL MALKA"],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Porto Seguro está pronta! "
            "Nº de compra: LA9571272YJSA. Código de reserva: MJPTZK. "
            "CGH→BPS 25/12/2025 08:30 LA3192. BPS→GRU 08/01/2026 LA4716."
        ),
    },
    # ── 6b. Porto Seguro — CCARGE (1 pax, comprado 16/12/2025) ─────────────
    {
        "file_name": "gmail_flight_CCARGE.json",
        "file_path": "gmail/flights/gmail_flight_CCARGE.json",
        "nf_number": "CCARGE",
        "emission_date": "2025-12-16T22:58:33Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea CGH→BPS→GRU (Porto Seguro). Código de reserva: CCARGE. "
            "Compra: LA9572934KFAX. "
            "Partida: 25/12/2025 08:30 CGH (LA3192). "
            "Retorno: 08/01/2026 BPS→GRU (LA4716). 1 passageiro."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "19b289875bef5538",
        "gmail_message_id": "19b29630a556e00f",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "CGH",
                "dest_city": "Porto Seguro",
                "dest_airport": "BPS",
                "departure_date": "2025-12-25",
                "departure_time": "08:30",
                "airline": "LATAM",
                "flight_number": "LA3192",
                "booking_ref": "CCARGE",
                "passengers": [],  # unknown passenger name for this ticket
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Porto Seguro",
                "origin_airport": "BPS",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2026-01-08",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": "LA4716",
                "booking_ref": "CCARGE",
                "passengers": [],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Porto Seguro está pronta! "
            "Nº de compra: LA9572934KFAX. Código de reserva: CCARGE. "
            "CGH→BPS 25/12/2025 08:30 LA3192. BPS→GRU 08/01/2026 LA4716."
        ),
    },
    # ── 6c. Porto Seguro — UGXGXP (1 pax, comprado 16/12/2025) ─────────────
    {
        "file_name": "gmail_flight_UGXGXP.json",
        "file_path": "gmail/flights/gmail_flight_UGXGXP.json",
        "nf_number": "UGXGXP",
        "emission_date": "2025-12-16T19:17:17Z",
        "provider_name": "LATAM Airlines",
        "service_description": (
            "Passagem aérea CGH→BPS→GRU (Porto Seguro). Código de reserva: UGXGXP. "
            "Compra: LA9573297DCGB. "
            "Partida: 25/12/2025 08:30 CGH (LA3192). "
            "Retorno: 08/01/2026 BPS→GRU (LA4716). 1 passageiro."
        ),
        "category_slug": "viagens",
        "is_medical": False,
        "is_reimbursable": False,
        "gmail_thread_id": "19b289875bef5538",
        "gmail_message_id": "19b289875bef5538",
        "legs": [
            {
                "leg_order": 0,
                "direction": "outbound",
                "origin_city": "São Paulo",
                "origin_airport": "CGH",
                "dest_city": "Porto Seguro",
                "dest_airport": "BPS",
                "departure_date": "2025-12-25",
                "departure_time": "08:30",
                "airline": "LATAM",
                "flight_number": "LA3192",
                "booking_ref": "UGXGXP",
                "passengers": [],
                "fare_class": None,
            },
            {
                "leg_order": 1,
                "direction": "return",
                "origin_city": "Porto Seguro",
                "origin_airport": "BPS",
                "dest_city": "São Paulo",
                "dest_airport": "GRU",
                "departure_date": "2026-01-08",
                "departure_time": None,
                "airline": "LATAM",
                "flight_number": "LA4716",
                "booking_ref": "UGXGXP",
                "passengers": [],
                "fare_class": None,
            },
        ],
        "raw_text": (
            "LATAM Airlines. Sua viagem a Porto Seguro está pronta! "
            "Nº de compra: LA9573297DCGB. Código de reserva: UGXGXP. "
            "CGH→BPS 25/12/2025 08:30 LA3192. BPS→GRU 08/01/2026 LA4716."
        ),
    },
]


# ── Transaction matching ─────────────────────────────────────────────────────


def _installment_total(amount: float, desc: str) -> float:
    """If description contains 'XX/YY' installment pattern, return amount * YY."""
    import re

    m = re.search(r"\b(\d{2})/(\d{2})\b", desc or "")
    if m:
        total_installments = int(m.group(2))
        if total_installments > 1:
            return round(amount * total_installments, 2)
    return amount


def find_matching_transaction(sb, purchase_date_str: str, exclude_ids: set = None):
    """
    Search for a LATAM/airline transaction near the purchase date.
    Returns (transaction_id, confidence, total_purchase_amount) or (None, 'none', None).

    Rules:
    - Search ±15 days to catch delayed billing (international cards)
    - Include LATAM PASS boleto payments
    - When multiple matches on same date, prefer LARGER installment-adjusted amount
    - Skip IDs in exclude_ids (avoids two trips claiming the same transaction)
    """
    try:
        from datetime import date, timedelta
        import re

        pd = date.fromisoformat(purchase_date_str[:10])
        d_from = (pd - timedelta(days=15)).isoformat()
        d_to = (pd + timedelta(days=15)).isoformat()

        resp = (
            sb.table("transactions")
            .select("id, date, description_clean, real_amount")
            .gte("date", d_from)
            .lte("date", d_to)
            .lt("real_amount", 0)
            .eq("is_fake", False)
            .execute()
        )

        rows = resp.data or []
        exclude_ids = exclude_ids or set()

        latam_rows = [
            r
            for r in rows
            if r["id"] not in exclude_ids
            and r.get("description_clean")
            and any(
                kw in r["description_clean"].upper() for kw in ["LATAM", "GOL", "AZUL"]
            )
        ]

        if not latam_rows:
            return None, "none", None

        def score(r):
            try:
                days = abs((date.fromisoformat(r["date"]) - pd).days)
            except Exception:
                days = 999
            amt = abs(float(r["real_amount"]))
            total = _installment_total(amt, r.get("description_clean", ""))
            # Primary sort: days away (closer = better)
            # Secondary: prefer larger amounts (main ticket vs ancillary)
            return (days, -total)

        best = min(latam_rows, key=score)

        try:
            days_diff = abs((date.fromisoformat(best["date"]) - pd).days)
        except Exception:
            days_diff = 99

        amt = abs(float(best["real_amount"]))
        total = _installment_total(amt, best.get("description_clean", ""))
        confidence = "high" if days_diff <= 1 else "medium" if days_diff <= 7 else "low"
        return best["id"], confidence, total

    except Exception as e:
        print(f"    WARN match error: {e}")
        return None, "none", None


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Load existing file_names to skip duplicates
    existing_resp = (
        sb.table("nota_fiscais")
        .select("file_name")
        .eq("source_type", "gmail_email")
        .execute()
    )
    existing = {r["file_name"] for r in (existing_resp.data or [])}
    print(f"Already in DB: {len(existing)} gmail flight records")

    inserted = 0
    skipped = 0
    claimed_tx_ids: set = set()  # prevent two trips from claiming the same transaction

    for trip in TRIPS:
        fname = trip["file_name"]
        if fname in existing:
            print(f"SKIP (already in DB): {fname}")
            skipped += 1
            continue

        purchase_date = trip["emission_date"][:10]
        if trip.get("skip_matching"):
            tx_id, confidence, matched_amount = None, "none", None
        else:
            tx_id, confidence, matched_amount = find_matching_transaction(
                sb, purchase_date, exclude_ids=claimed_tx_ids
            )
        if tx_id:
            claimed_tx_ids.add(tx_id)

        total_amount = matched_amount if matched_amount else 0.0
        match_source = "gmail" if tx_id else None

        nf_row = {
            "file_name": fname,
            "file_path": trip["file_path"],
            "source_type": "gmail_email",
            "nf_number": trip["nf_number"],
            "emission_date": trip["emission_date"],
            "provider_name": trip["provider_name"],
            "service_description": trip["service_description"],
            "category_slug": trip["category_slug"],
            "is_medical": trip["is_medical"],
            "is_reimbursable": trip["is_reimbursable"],
            "total_amount": total_amount,
            "gmail_thread_id": trip["gmail_thread_id"],
            "gmail_message_id": trip["gmail_message_id"],
            "raw_text": trip["raw_text"],
            "transaction_id": tx_id,
            "match_confidence": confidence,
            "match_source": match_source,
            "reimbursement_status": "not_submitted",
        }

        if args.dry_run:
            status = f"tx={tx_id} conf={confidence} amount={total_amount}"
            print(f"DRY  {fname}: {status}")
            continue

        # Insert nota_fiscal
        nf_resp = sb.table("nota_fiscais").insert(nf_row).execute()
        nf_data = nf_resp.data
        if not nf_data:
            print(f"  ERROR inserting {fname}")
            continue
        nf_id = nf_data[0]["id"]

        # Insert flight legs
        for leg in trip["legs"]:
            leg_row = {
                "nota_fiscal_id": nf_id,
                "leg_order": leg["leg_order"],
                "direction": leg["direction"],
                "origin_city": leg["origin_city"],
                "origin_airport": leg["origin_airport"],
                "dest_city": leg["dest_city"],
                "dest_airport": leg["dest_airport"],
                "departure_date": leg["departure_date"],
                "departure_time": leg["departure_time"],
                "airline": leg["airline"],
                "flight_number": leg["flight_number"],
                "booking_ref": leg["booking_ref"],
                "passengers": leg["passengers"] or [],
                "fare_class": leg["fare_class"],
            }
            sb.table("nota_fiscal_flights").insert(leg_row).execute()

        tx_info = (
            f"→ tx matched={tx_id is not None} conf={confidence} amount={total_amount:.2f}"
            if total_amount
            else "→ no tx match"
        )
        print(f"OK  {fname} ({trip['nf_number']}) {tx_info}")
        inserted += 1

    print(f"\nDone. inserted={inserted} skipped={skipped} (dry_run={args.dry_run})")


if __name__ == "__main__":
    main()
