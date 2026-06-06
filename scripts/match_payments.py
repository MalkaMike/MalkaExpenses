"""
Payment matcher — binds each nota fiscal to the bank transaction(s) that pay it,
understanding installment plans, single payments, unequal splits, and recurring
monthly services.

It is a 4-phase greedy bipartite assignment. Each transaction can be claimed by
AT MOST ONE nota (global claim set) — this is what stops the same charge being
counted for several notas (the bug a naive amount+date matcher has).

  Phase 1  installment plan   — "k/M" marker + per_amount*M ~= nota_total + merchant
  Phase 2  single payment     — one charge ~= total, same merchant, near date
  Phase 3  subset-sum split   — minimal subset of same-merchant charges summing to total
  Phase 4  recurring 1:1      — monthly service; nota grabs its own nearest single charge

Rolls a payment_status up onto nota_fiscais and writes the detail to
nota_fiscal_payments.

Run:  python -X utf8 scripts/match_payments.py            (dry-run, prints assignment)
      python -X utf8 scripts/match_payments.py --apply
      python -X utf8 scripts/match_payments.py --apply --medical-only
"""

import sys
import re
import unicodedata
import itertools
from datetime import date, datetime
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _nf_db import client, fetch_all  # noqa: E402

APPLY = "--apply" in sys.argv
MED_ONLY = "--medical-only" in sys.argv
TODAY = date.today()

MARKER = re.compile(r"\b(\d{1,2})/(\d{2})\b")
CORP_STOP = {
    "CLINICA",
    "SERVICOS",
    "SERVICO",
    "MEDICOS",
    "MEDICA",
    "LTDA",
    "SA",
    "SS",
    "ME",
    "EIRELI",
    "ESP",
    "EM",
    "DE",
    "DA",
    "DO",
    "DOS",
    "DAS",
    "E",
    "DR",
    "DRA",
    "ASSISTENCIA",
    "SOCIEDADE",
    "HOSPITAL",
    "BENEF",
    "PSIQUIATRICA",
    "PSICOLOGICA",
    "INFEC",
    "PARAS",
    "IMUN",
    "INSTITUTO",
    "BELEZA",
    "EST",
    "COMERCIO",
    "INDUSTRIA",
    "PRODUCOES",
    "ADVOGADOS",
    "ASSOCIADOS",
    # geographic / generic — too common to identify a merchant
    "BRASIL",
    "BRASILEIRA",
    "BRAS",
    "SAO",
    "PAULO",
    "RIO",
    "JANEIRO",
    "VAREJO",
    "SHOPPING",
    "SHOP",
    "CENTER",
    "CENTRO",
    "COMERCIAL",
    "LOJA",
}
# Common surnames — too generic to match on alone (avoids over-matching person names)
SURNAME_STOP = {
    "SILVA",
    "SANTOS",
    "COSTA",
    "SOUZA",
    "SOUSA",
    "PEREIRA",
    "OLIVEIRA",
    "LIMA",
    "CARDOSO",
    "MOREIRA",
    "RIBEIRO",
    "ALVES",
    "GOMES",
    "MARTINS",
    "ROCHA",
    "CARVALHO",
    "ALMEIDA",
    "NETO",
    "JUNIOR",
    "CHRISTINA",
    "MARIA",
    "JOSE",
    "CARLOS",
    "LUIZ",
    "LUIS",
}


def norm(s: str) -> str:
    s = (
        unicodedata.normalize("NFKD", s or "")
        .encode("ascii", "ignore")
        .decode()
        .upper()
    )
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s)).strip()


# Known truncated/abbreviated provider names as they appear in bank statements.
# Maps a token found in the NF provider name -> extra match substrings to look
# for in the transaction description (boletos/cards truncate long names).
ALIASES = {
    "EINSTEIN": ["ISR B HOSP", "HOSP ALB", "ALB EIN", "ISRAELITA"],
    "ISRAELITABRAS": ["ISR B HOSP", "HOSP ALB", "ALB EIN"],
}


def provider_keys(name: str):
    """Return (tokens, sig, aliases). tokens = distinctive words matched against
    tx text; sig = despaced first-two-words signature (e.g. 'R3 CLINICA' vs tx
    'R 3 CLINICA'); aliases = known truncated forms a bank statement may use."""
    words = norm(name).split()
    toks = [w for w in words if len(w) >= 4 and w not in CORP_STOP]
    distinctive = [w for w in toks if w not in SURNAME_STOP]
    sig = "".join(words[:2])
    sig = sig if len(sig) >= 5 else ""
    aliases = []
    for w in words:
        if w in ALIASES:
            aliases.extend(ALIASES[w])
    return (distinctive or toks), sig, aliases


def d10(s):
    return (s or "")[:10]


def to_date(s):
    return datetime.strptime(d10(s), "%Y-%m-%d").date()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sb = client()
    nfs = fetch_all(sb, "nota_fiscais")
    txs_all = fetch_all(sb, "transactions")
    txs = [
        t
        for t in txs_all
        if not t.get("is_fake") and float(t.get("real_amount") or 0) < 0
    ]

    # Decorate transactions
    TX = []
    for t in txs:
        desc = t.get("description_clean") or ""
        m = MARKER.search(desc)
        mk = (
            (int(m.group(1)), int(m.group(2)))
            if m
            and 2 <= int(m.group(2)) <= 36
            and 1 <= int(m.group(1)) <= int(m.group(2))
            else None
        )
        try:
            dt = to_date(t["date"])
        except Exception:
            continue
        nm = norm(desc)
        TX.append(
            {
                "id": t["id"],
                "norm": nm,
                "nospace": nm.replace(" ", ""),
                "raw": desc,
                "mk": mk,
                "amt": round(abs(float(t["real_amount"])), 2),
                "date": dt,
                "claimed": False,
            }
        )

    def merch_match(tokens, sig, aliases, tx):
        if any(tok in tx["norm"] for tok in tokens):
            return True
        if sig and sig in tx["nospace"]:
            return True
        return any(al in tx["norm"] for al in (aliases or []))

    payments = []  # dicts ready for insert
    plan_count = {"installment_marker": 0, "single": 0, "subset_sum": 0, "recurring": 0}

    def claim(nf, tx, k, M, method, conf):
        tx["claimed"] = True
        payments.append(
            {
                "nota_fiscal_id": nf["id"],
                "transaction_id": tx["id"],
                "installment_k": k,
                "installment_m": M,
                "amount": tx["amt"],
                "charge_date": tx["date"].isoformat(),
                "is_future": tx["date"] > TODAY,
                "match_method": method,
                "match_confidence": conf,
            }
        )

    targets = [n for n in nfs if (n["is_reimbursable"] if MED_ONLY else True)]
    # Process largest first (big plans are least ambiguous).
    targets.sort(key=lambda n: -float(n["total_amount"] or 0))

    nf_plan = {}  # nf_id -> (method, M)

    # ── PHASE 1: installment-marker plans ─────────────────────────────────────
    for nf in targets:
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        cand = [
            t
            for t in TX
            if not t["claimed"]
            and t["mk"]
            and merch_match(toks, sig, ali, t)
            and abs((t["date"] - d0).days) <= 560
        ]
        # cluster into plan instances by (M, per) then consecutive k-runs
        groups = defaultdict(list)
        for t in cand:
            groups[(t["mk"][1], t["amt"])].append(t)
        best = None  # (anchor_distance, instance_txs, M, per)
        for (M, per), items in groups.items():
            if abs(per * M - A) > max(2.0, A * 0.04):
                continue
            items.sort(key=lambda t: (t["date"], t["mk"][0]))
            # split into runs (new run when k resets to <= previous)
            run, prevk = [], 0
            runs = []
            for t in items:
                k = t["mk"][0]
                if run and k <= prevk:
                    runs.append(run)
                    run = []
                run.append(t)
                prevk = k
            if run:
                runs.append(run)
            for r in runs:
                anchor = min(r, key=lambda t: t["mk"][0])["date"]
                dist = abs((anchor - d0).days)
                if dist <= 120 and (best is None or dist < best[0]):
                    best = (dist, r, M, per)
        if best:
            _, r, M, per = best
            for t in r:
                claim(nf, t, t["mk"][0], M, "installment_marker", "high")
            nf_plan[nf["id"]] = ("installment_marker", M)
            plan_count["installment_marker"] += 1

    # ── PHASE 1b: equal-value installments WITHOUT a k/M marker ──────────────
    # Brazilian rule: a "parcelado" plan splits the face into M near-equal parts
    # (cents differ from rounding). If same-merchant charges of near-equal value,
    # on a monthly cadence, satisfy per*M == face, it's a plan even with no marker.
    # SPECULATIVE — restricted to medical/education where proof-of-payment matters
    # and where it gets human/adversarial review (avoids noise on subscriptions/retail).
    def speculative_target(nf):
        return nf.get("is_reimbursable") or nf.get("category_slug") in (
            "saude",
            "educacao",
        )

    for nf in targets:
        if nf["id"] in nf_plan or not speculative_target(nf):
            continue
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        pool = [
            t
            for t in TX
            if not t["claimed"]
            and merch_match(toks, sig, ali, t)
            and -45 <= (t["date"] - d0).days <= 560
            and t["amt"] < A - 0.01  # a partial (< face) — the installment signal
        ]
        best = None  # (count, charges, M, per)
        for M in range(2, 19):
            per = round(A / M, 2)
            tolc = max(0.05, per * 0.02)  # "a few cents" rounding tolerance
            grp = sorted(
                [t for t in pool if abs(t["amt"] - per) <= tolc],
                key=lambda t: t["date"],
            )
            if len(grp) < 2 or abs(per * M - A) > max(0.05, M * 0.02):
                continue
            gaps = [
                (grp[i + 1]["date"] - grp[i]["date"]).days for i in range(len(grp) - 1)
            ]
            if gaps and all(18 <= g <= 48 for g in gaps):  # monthly cadence
                if best is None or len(grp) > best[0]:
                    best = (len(grp), grp[:M], M, per)
        if best:
            _, grp, M, per = best
            for i, t in enumerate(grp):
                claim(nf, t, i + 1, M, "equal_value", "medium")
            nf_plan[nf["id"]] = ("equal_value", M)
            plan_count["equal_value"] = plan_count.get("equal_value", 0) + 1

    # ── PHASE 2: single exact payment ─────────────────────────────────────────
    for nf in targets:
        if nf["id"] in nf_plan:
            continue
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        cand = [
            t
            for t in TX
            if not t["claimed"]
            and merch_match(toks, sig, ali, t)
            and abs(t["amt"] - A) <= max(5.0, A * 0.03)
            and abs((t["date"] - d0).days) <= 45
        ]
        if cand:
            t = min(cand, key=lambda x: abs((x["date"] - d0).days))
            claim(nf, t, None, 1, "single", "high")
            nf_plan[nf["id"]] = ("single", 1)
            plan_count["single"] += 1

    # ── PHASE 3: subset-sum split ─────────────────────────────────────────────
    for nf in targets:
        if nf["id"] in nf_plan:
            continue
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        pool = sorted(
            [
                t
                for t in TX
                if not t["claimed"]
                and merch_match(toks, sig, ali, t)
                and abs((t["date"] - d0).days) <= 120
            ],
            key=lambda t: abs((t["date"] - d0).days),
        )[:12]
        found = None
        tol = max(10.0, A * 0.04)
        for size in (2, 3, 4):
            for combo in itertools.combinations(pool, size):
                if abs(sum(c["amt"] for c in combo) - A) <= tol:
                    found = combo
                    break
            if found:
                break
        if found:
            for t in found:
                claim(nf, t, None, len(found), "subset_sum", "medium")
            nf_plan[nf["id"]] = ("subset_sum", len(found))
            plan_count["subset_sum"] += 1

    # ── PHASE 4: recurring 1:1 (nearest single, amount ~= total) ──────────────
    for nf in sorted(targets, key=lambda n: d10(n.get("emission_date"))):
        if nf["id"] in nf_plan:
            continue
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        cand = [
            t
            for t in TX
            if not t["claimed"]
            and merch_match(toks, sig, ali, t)
            and abs(t["amt"] - A) <= max(5.0, A * 0.05)
            and abs((t["date"] - d0).days) <= 75
        ]
        if cand:
            t = min(cand, key=lambda x: abs((x["date"] - d0).days))
            claim(nf, t, None, 1, "recurring", "medium")
            nf_plan[nf["id"]] = ("recurring", 1)
            plan_count["recurring"] += 1

    # ── PHASE 5: Pix-to-named-payee recovery (residual, wider window) ─────────
    # Last resort for still-unmatched notas: accept a charge that NAMES the
    # provider (Pix/boleto to the clinic/professional) within a wider window.
    # Low confidence; the naming requirement is what keeps it safe.
    for nf in sorted(targets, key=lambda n: d10(n.get("emission_date"))):
        if nf["id"] in nf_plan or not speculative_target(nf):
            continue
        A = round(float(nf["total_amount"] or 0), 2)
        if A <= 0:
            continue
        toks, sig, ali = provider_keys(nf["provider_name"])
        if not toks and not sig and not ali:
            continue
        d0 = to_date(nf["emission_date"]) if nf.get("emission_date") else None
        if not d0:
            continue
        cand = [
            t
            for t in TX
            if not t["claimed"]
            and merch_match(toks, sig, ali, t)
            and abs(t["amt"] - A) <= max(5.0, A * 0.03)
            and abs((t["date"] - d0).days) <= 150
        ]
        if cand:
            t = min(cand, key=lambda x: abs((x["date"] - d0).days))
            claim(nf, t, None, 1, "pix_named", "low")
            nf_plan[nf["id"]] = ("pix_named", 1)
            plan_count["pix_named"] = plan_count.get("pix_named", 0) + 1

    # ── Roll up status per nota ───────────────────────────────────────────────
    by_nf = defaultdict(list)
    for p in payments:
        by_nf[p["nota_fiscal_id"]].append(p)

    rollups = {}
    for nf in targets:
        ps = by_nf.get(nf["id"], [])
        method, M = nf_plan.get(nf["id"], (None, None))
        if not ps:
            rollups[nf["id"]] = {
                "payment_status": "no_proof",
                "installments_total": None,
                "installments_paid": 0,
                "amount_paid": 0,
                "amount_pending": 0,
            }
            continue
        Mtot = (
            M
            if method in ("installment_marker", "equal_value")
            else (len(ps) if method == "subset_sum" else 1)
        )
        paid_charges = [p for p in ps if not p["is_future"]]
        fut_charges = [p for p in ps if p["is_future"]]
        amt_paid = round(sum(p["amount"] for p in paid_charges), 2)
        amt_pend = round(sum(p["amount"] for p in fut_charges), 2)
        ipaid = len(paid_charges)
        if method in ("installment_marker", "equal_value"):
            # Pending = remainder of the plan total, even if some future
            # installments aren't present in the data yet.
            per = ps[0]["amount"]
            expected = round(per * Mtot, 2)
            amt_pend = round(max(amt_pend, expected - amt_paid), 2)
            status = (
                "paid_full"
                if ipaid >= Mtot
                else ("paying" if ipaid > 0 else "scheduled")
            )
        else:
            status = (
                "paid_full"
                if not fut_charges
                else ("paying" if paid_charges else "scheduled")
            )
        rollups[nf["id"]] = {
            "payment_status": status,
            "installments_total": Mtot,
            "installments_paid": ipaid,
            "amount_paid": amt_paid,
            "amount_pending": amt_pend,
        }

    # ── Report ────────────────────────────────────────────────────────────────
    print(
        f"Today: {TODAY}   Mode: {'APPLY' if APPLY else 'DRY RUN'}   Scope: {'medical only' if MED_ONLY else 'ALL notas'}"
    )
    print(f"Notas processed: {len(targets)}   Charges claimed: {len(payments)}")
    print(f"Plans: {plan_count}")
    matched = sum(1 for n in targets if n["id"] in nf_plan)
    print(f"Matched: {matched}/{len(targets)}   No proof: {len(targets) - matched}")
    print()
    sc = defaultdict(int)
    for r in rollups.values():
        sc[r["payment_status"]] += 1
    print("Status distribution:", dict(sc))
    print()
    # Show medical detail
    med = [n for n in targets if n["is_reimbursable"]]
    print(f"── REIMBURSABLE (medical) — {len(med)} notas ──")
    for nf in sorted(med, key=lambda n: -float(n["total_amount"] or 0)):
        r = rollups[nf["id"]]
        method, M = nf_plan.get(nf["id"], ("none", None))
        plan = (
            f"{r['installments_total']}x"
            if (r["installments_total"] or 0) > 1
            else method
        )
        print(
            f"  {d10(nf['emission_date'])}  {(nf['provider_name'] or '')[:28]:28s} "
            f"R${float(nf['total_amount'] or 0):>9,.2f}  {r['payment_status']:9s} "
            f"{r['installments_paid']}/{r['installments_total'] or '?'}  "
            f"pago R${r['amount_paid']:>9,.2f}  falta R${r['amount_pending']:>9,.2f}  [{method}]"
        )

    if not APPLY:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return

    # ── Apply ─────────────────────────────────────────────────────────────────
    import json

    snap = {"nota_fiscais": nfs}
    bp = Path(".local/nf_backups/nf_backup_pre_payments.json")
    bp.parent.mkdir(parents=True, exist_ok=True)
    bp.write_text(
        json.dumps(snap, ensure_ascii=False, default=str, indent=1), encoding="utf-8"
    )
    print(f"\nBackup: {bp}")

    # Clear existing payment rows for the processed notas, then insert fresh.
    nf_ids = [n["id"] for n in targets]
    for i in range(0, len(nf_ids), 50):
        sb.from_("nota_fiscal_payments").delete().in_(
            "nota_fiscal_id", nf_ids[i : i + 50]
        ).execute()
    for i in range(0, len(payments), 100):
        sb.from_("nota_fiscal_payments").insert(payments[i : i + 100]).execute()

    for nf_id, r in rollups.items():
        sb.from_("nota_fiscais").update(r).eq("id", nf_id).execute()

    print(f"APPLIED: {len(payments)} payment rows, {len(rollups)} nota rollups.")


if __name__ == "__main__":
    main()
