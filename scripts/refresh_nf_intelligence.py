"""
Refresh nota_fiscais intelligence — safe to run on a schedule.

Two deterministic, idempotent steps:
  1. DEDUP — collapse notas that are the same document imported from more than one
     source (PDF folder + SP portal + Gmail). Keeps the richest copy by source
     priority (pdf_folder > nfse_portal > gmail_email), then longest raw_text,
     then earliest created_at. Transaction links are NOT considered here because
     step 2 recomputes them from scratch — so a duplicate can never "win" by
     carrying a wrong link.
  2. MATCH — re-run scripts/match_payments.py --apply, which rebuilds every
     payment link + payment_status. Installments tick forward automatically as
     future-dated charges become past (so this is worth running even on weeks
     with no new notas).

Run:  python -X utf8 scripts/refresh_nf_intelligence.py            (dry-run dedup, then match)
      python -X utf8 scripts/refresh_nf_intelligence.py --apply
"""

import sys
import re
import json
import subprocess
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _nf_db import client, fetch_all  # noqa: E402

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
APPLY = "--apply" in sys.argv

SRC_RANK = {"pdf_folder": 3, "nfse_portal": 2, "gmail_email": 1}


def norm(s: str) -> str:
    s = (
        unicodedata.normalize("NFKD", s or "")
        .encode("ascii", "ignore")
        .decode()
        .upper()
    )
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s)).strip()


def dedup(sb) -> int:
    nfs = fetch_all(sb, "nota_fiscais")
    groups = defaultdict(list)
    for n in nfs:
        key = (
            norm(n.get("provider_name")),
            (n.get("emission_date") or "")[:10],
            round(float(n.get("total_amount") or 0), 2),
            norm(n.get("patient_name")),
        )
        groups[key].append(n)

    to_delete = []
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        rows.sort(
            key=lambda r: (
                -SRC_RANK.get(r.get("source_type"), 0),
                -len(r.get("raw_text") or ""),
                r.get("created_at") or "",
            )
        )
        survivor = rows[0]
        for r in rows[1:]:
            to_delete.append((r, survivor))

    print(
        f"DEDUP — {len(to_delete)} duplicate notas to remove (out of {len(nfs)} total)"
    )
    for r, surv in to_delete[:30]:
        print(
            f"  DEL {(r.get('emission_date') or '')[:10]} "
            f"{(r.get('provider_name') or '')[:34]:34s} "
            f"R${float(r.get('total_amount') or 0):>9,.2f} [{r.get('source_type')}] "
            f"-> keep [{surv.get('source_type')}]"
        )
    if len(to_delete) > 30:
        print(f"  ... +{len(to_delete) - 30} more")

    if not APPLY or not to_delete:
        return len(to_delete)

    # Backup then delete
    bdir = PROJECT_ROOT / ".local" / "nf_backups"
    bdir.mkdir(parents=True, exist_ok=True)
    snap = {"nota_fiscais": nfs}
    (bdir / "nf_backup_pre_refresh.json").write_text(
        json.dumps(snap, ensure_ascii=False, default=str, indent=1), encoding="utf-8"
    )
    for r, _ in to_delete:
        sb.from_("nota_fiscais").delete().eq("id", r["id"]).execute()
    return len(to_delete)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"=== Refresh NF intelligence ({'APPLY' if APPLY else 'DRY RUN'}) ===\n")

    sb = client()
    removed = dedup(sb)
    print(f"\nDedup {'removed' if APPLY else 'would remove'}: {removed}\n")

    # Re-run the payment matcher (its own dry-run/apply mirrors ours)
    cmd = [sys.executable, "-X", "utf8", str(SCRIPT_DIR / "match_payments.py")]
    if APPLY:
        cmd.append("--apply")
    print("Running payment matcher…\n" + "-" * 60)
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
