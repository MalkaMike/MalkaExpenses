"""
Deterministic executor for a nota_fiscais cleanup action list.

The PLAN (which rows to delete/update and why) is produced by the audit
workflow and written to a JSON file. This script is the only thing that
mutates the DB — it acts ONLY on explicit row IDs, never on broad WHERE
clauses, and only touches a whitelist of columns.

Action-list JSON format:
{
  "deletes": [
    {"id": "<uuid>", "reason": "...", "provider": "...", "amount": 123.45}
  ],
  "updates": [
    {"id": "<uuid>", "fields": {"is_medical": false, "category_slug": "bem_estar"},
     "reason": "..."}
  ]
}

Usage:
    python -X utf8 scripts/apply_nf_cleanup.py <actions.json> --dry-run
    python -X utf8 scripts/apply_nf_cleanup.py <actions.json> --apply
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _nf_db import client, fetch_all  # noqa: E402

# Columns this script is allowed to UPDATE. Anything else is rejected — a guard
# against a bad plan touching money or foreign keys it shouldn't.
ALLOWED_UPDATE_FIELDS = {
    "is_medical",
    "is_education",
    "is_reimbursable",
    "category_slug",
    "patient_name",
    "provider_name",
    "transaction_id",
    "match_confidence",
    "match_source",
    "no_match_reason",
    "reimbursement_status",
}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    apply = "--apply" in args
    dry = "--dry-run" in args or not apply
    json_files = [a for a in args if not a.startswith("--")]
    if not json_files:
        print("Usage: apply_nf_cleanup.py <actions.json> [--dry-run|--apply]")
        sys.exit(1)

    plan = json.loads(Path(json_files[0]).read_text(encoding="utf-8"))
    deletes = plan.get("deletes", [])
    updates = plan.get("updates", [])

    print(f"Plan: {json_files[0]}")
    print(f"Mode: {'APPLY' if apply else 'DRY RUN'}")
    print(f"  deletes: {len(deletes)}")
    print(f"  updates: {len(updates)}")
    print()

    sb = client()

    # Snapshot current state right before mutating (second safety net).
    if apply:
        snap = {
            t: fetch_all(sb, t)
            for t in ["nota_fiscais", "nota_fiscal_items", "nota_fiscal_flights"]
        }
        bdir = Path(__file__).parent.parent / ".local" / "nf_backups"
        bdir.mkdir(parents=True, exist_ok=True)
        bpath = bdir / "nf_backup_pre_apply.json"
        bpath.write_text(
            json.dumps(snap, ensure_ascii=False, default=str, indent=1),
            encoding="utf-8",
        )
        print(f"Pre-apply backup: {bpath} ({bpath.stat().st_size // 1024} KB)\n")

    # Build a live id->row index for validation + before-values.
    live = {r["id"]: r for r in fetch_all(sb, "nota_fiscais")}

    # ── Validate ────────────────────────────────────────────────────────────
    errors = []
    for d in deletes:
        if d["id"] not in live:
            errors.append(f"delete: id {d['id']} not found (already gone?)")
    for u in updates:
        if u["id"] not in live:
            errors.append(f"update: id {u['id']} not found")
        bad = set(u.get("fields", {})) - ALLOWED_UPDATE_FIELDS
        if bad:
            errors.append(f"update {u['id']}: disallowed fields {bad}")

    # An id should not be both deleted and updated; delete wins.
    del_ids = {d["id"] for d in deletes}
    updates = [u for u in updates if u["id"] not in del_ids]

    if errors:
        print("VALIDATION ISSUES (these actions will be skipped):")
        for e in errors[:50]:
            print(f"  ! {e}")
        print()

    # ── Dry-run log ───────────────────────────────────────────────────────────
    print("── DELETES ──")
    for d in deletes:
        row = live.get(d["id"])
        if not row:
            continue
        amt = float(row.get("total_amount") or 0)
        print(
            f"  DEL {(row.get('emission_date') or '')[:10]}  "
            f"{(row.get('provider_name') or '')[:38]:38s}  R${amt:>9,.2f}  "
            f"[{row.get('source_type')}]  — {d.get('reason', '')[:50]}"
        )

    print("\n── UPDATES ──")
    for u in updates:
        row = live.get(u["id"])
        if not row:
            continue
        changes = []
        for k, v in u.get("fields", {}).items():
            old = row.get(k)
            if str(old) != str(v):
                changes.append(f"{k}: {old!r}→{v!r}")
        if changes:
            print(
                f"  UPD {(row.get('provider_name') or '')[:34]:34s}  "
                f"{'; '.join(changes)[:90]}  — {u.get('reason', '')[:40]}"
            )

    if dry and not apply:
        print("\nDRY RUN — nothing changed. Re-run with --apply to execute.")
        return

    # ── Apply ─────────────────────────────────────────────────────────────────
    applied_del, applied_upd = 0, 0
    for u in updates:
        if u["id"] not in live:
            continue
        fields = {
            k: v for k, v in u.get("fields", {}).items() if k in ALLOWED_UPDATE_FIELDS
        }
        if fields:
            sb.from_("nota_fiscais").update(fields).eq("id", u["id"]).execute()
            applied_upd += 1

    for d in deletes:
        if d["id"] not in live:
            continue
        sb.from_("nota_fiscais").delete().eq("id", d["id"]).execute()
        applied_del += 1

    print(f"\nAPPLIED: {applied_del} deletes, {applied_upd} updates.")
    print(f"Remaining nota_fiscais: {len(fetch_all(sb, 'nota_fiscais', 'id'))}")


if __name__ == "__main__":
    main()
