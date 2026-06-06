"""Shared Supabase connection helper for nota_fiscais maintenance scripts.

Every NF audit/cleanup script imports this so connection logic is identical
and correct everywhere.

    from _nf_db import client, fetch_all
    sb = client()
    nfs = fetch_all(sb, "nota_fiscais")
"""

from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent


def load_env() -> dict:
    env = {}
    p = PROJECT_ROOT / ".env.local"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def client():
    env = load_env()
    from supabase import create_client

    return create_client(
        env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]
    )


def fetch_all(sb, table: str, select: str = "*") -> list:
    """Fetch every row from a table, paging past the 1000-row PostgREST cap."""
    rows, start = [], 0
    while True:
        res = sb.from_(table).select(select).range(start, start + 999).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    return rows
