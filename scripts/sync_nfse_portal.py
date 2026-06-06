"""
Weekly sync of SP NFS-e portal CSV into nota_fiscais.

How it works:
  1. Logs into https://nfe.prefeitura.sp.gov.br/ with CPF + password.
  2. Exports the CSV for the last 18 months (catches any late-arriving NFs).
  3. Saves it to Downloads/ with a timestamped filename.
  4. Runs import_nfse_portal.py on it.
  5. Prints a summary.

Setup (one-time):
  pip install requests
  Add to ~/.claude/secrets.local.env:
    NFS_SP_CPF=23304126813
    NFS_SP_PASSWORD=<your portal password>

Scheduled via Windows Task Scheduler (see scripts/setup_nfse_scheduler.ps1).
"""

import re
import sys
import os
import subprocess
from pathlib import Path
from datetime import datetime, timedelta

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent


def _load_secrets() -> dict:
    paths = [
        PROJECT_ROOT / ".env.local",
        Path.home() / ".claude" / "secrets.local.env",
    ]
    result = {}
    for p in paths:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    result[k.strip()] = v.strip()
    return result


def _get_hidden_fields(html: str) -> dict:
    """Extract all hidden <input> fields from an ASP.NET WebForms page."""
    fields = {}
    for m in re.finditer(
        r'<input[^>]+type=["\']hidden["\'][^>]*>', html, re.IGNORECASE
    ):
        tag = m.group(0)
        name_m = re.search(r'name=["\']([^"\']+)["\']', tag)
        val_m = re.search(r'value=["\']([^"\']*)["\']', tag)
        if name_m:
            fields[name_m.group(1)] = val_m.group(1) if val_m else ""
    return fields


def _portal_login(cpf: str, password: str):
    """Authenticate to the NFS-e portal; returns a logged-in requests.Session."""
    import requests

    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    base = "https://nfe.prefeitura.sp.gov.br"

    # Step 1 — load login page to get ASP.NET hidden fields
    login_url = f"{base}/login.aspx"
    r = session.get(login_url, timeout=30)
    r.raise_for_status()
    fields = _get_hidden_fields(r.text)

    # Detect the form field names (SP portal uses ASPX naming)
    # Common names: ctl00$ContentPlaceHolder1$txtCPF, txtSenha, etc.
    cpf_field = next(
        (
            k
            for k in fields
            if "cpf" in k.lower() or "login" in k.lower() or "usuario" in k.lower()
        ),
        None,
    )
    pw_field = next(
        (k for k in fields if "senha" in k.lower() or "password" in k.lower()),
        None,
    )

    if not cpf_field or not pw_field:
        # Fallback: try to find them via visible input names
        visible = re.findall(
            r'<input[^>]+type=["\'](?:text|password)["\'][^>]*>', r.text, re.IGNORECASE
        )
        names = []
        for tag in visible:
            n = re.search(r'name=["\']([^"\']+)["\']', tag)
            if n:
                names.append(n.group(1))
        raise RuntimeError(
            f"Could not detect CPF/password field names on login page.\n"
            f"Visible text/password fields: {names}\n"
            f"Inspect https://nfe.prefeitura.sp.gov.br/login.aspx manually."
        )

    # Step 2 — submit login
    payload = {
        **fields,
        cpf_field: cpf.replace(".", "").replace("-", ""),
        pw_field: password,
    }
    r2 = session.post(login_url, data=payload, timeout=30, allow_redirects=True)
    r2.raise_for_status()

    # Verify login succeeded (portal should redirect away from login page)
    if "login.aspx" in r2.url.lower() or "senha" in r2.text.lower()[:500]:
        raise RuntimeError(
            "Login failed — still on login page. "
            "Check NFS_SP_CPF and NFS_SP_PASSWORD in secrets.local.env."
        )

    print(f"  Logged in — session at {r2.url}")
    return session


def _export_csv(session, cpf: str, start_ym: str, end_ym: str, out_path: Path):
    """
    Navigate to the export page and download the CSV.

    start_ym / end_ym: "YYYYMM" strings, e.g. "202401", "202606"
    """
    import requests

    base = "https://nfe.prefeitura.sp.gov.br"
    export_url = (
        f"{base}/tomador/notasrecapuradas.aspx"
        f"?cpfcnpj={cpf}&inicio={start_ym}&fim={end_ym}&canceladas=0"
    )

    r = session.get(export_url, timeout=30)
    r.raise_for_status()
    fields = _get_hidden_fields(r.text)

    # Look for the CSV export button / link
    # SP portal usually has a "Planilha (CSV)" button that submits a form
    csv_btn = re.search(
        r"<input[^>]+(?:csv|planilha|exportar)[^>]*>", r.text, re.IGNORECASE
    )
    btn_name = None
    if csv_btn:
        tag = csv_btn.group(0)
        n = re.search(r'name=["\']([^"\']+)["\']', tag)
        if n:
            btn_name = n.group(1)

    if not btn_name:
        # Try to find any button/link containing "CSV" or "Planilha"
        anchors = re.findall(
            r'href=["\']([^"\']*(?:csv|planilha)[^"\']*)["\']', r.text, re.IGNORECASE
        )
        if anchors:
            dl_url = (
                anchors[0]
                if anchors[0].startswith("http")
                else base + "/" + anchors[0].lstrip("/")
            )
            r2 = session.get(dl_url, timeout=60)
            r2.raise_for_status()
            out_path.write_bytes(r2.content)
            return

        raise RuntimeError(
            "Could not find the CSV export button on the NFS-e page.\n"
            "The portal layout may have changed. Inspect the page manually."
        )

    # POST the export form
    payload = {**fields, btn_name: "Planilha (CSV)"}
    r2 = session.post(export_url, data=payload, timeout=60, stream=True)
    r2.raise_for_status()

    content_type = r2.headers.get("Content-Type", "")
    if "text/html" in content_type:
        raise RuntimeError(
            "Export returned HTML instead of CSV — the portal may require "
            "additional navigation before exporting. Check manually."
        )

    with open(out_path, "wb") as f:
        for chunk in r2.iter_content(chunk_size=65536):
            f.write(chunk)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    dry_run = "--dry-run" in sys.argv

    secrets = _load_secrets()
    cpf = secrets.get("NFS_SP_CPF", "23304126813")
    password = secrets.get("NFS_SP_PASSWORD", "")

    now = datetime.now()
    print(f"NFS-e Weekly Sync — {now.strftime('%Y-%m-%d %H:%M')}")
    print(f"Mode:   {'DRY RUN' if dry_run else 'LIVE'}")
    print()

    # ── Step 1: portal import (best-effort) ─────────────────────────────────────
    # If the portal password isn't configured, or login/export fails, we SKIP the
    # import but still run the intelligence refresh below (installments tick
    # forward from bank data even with no new notas).
    if not password:
        print(
            "NOTE: NFS_SP_PASSWORD not set — skipping portal import.\n"
            "      To enable: add NFS_SP_PASSWORD to ~/.claude/secrets.local.env.\n"
            "      (Intelligence refresh still runs below.)\n"
        )
    else:
        start = (now - timedelta(days=548)).replace(day=1)  # ~18 months
        start_ym, end_ym = start.strftime("%Y%m"), now.strftime("%Y%m")
        out_path = (
            Path.home() / "Downloads" / f"NFSe_sync_{now.strftime('%Y%m%d_%H%M%S')}.csv"
        )
        print(f"Portal range: {start_ym} → {end_ym}  ->  {out_path.name}")
        try:
            print("Logging in to portal…")
            session = _portal_login(cpf, password)
            print("Exporting CSV…")
            _export_csv(session, cpf, start_ym, end_ym, out_path)
            size_kb = out_path.stat().st_size // 1024
            print(f"Downloaded {size_kb} KB.")
            imp = [
                sys.executable,
                "-X",
                "utf8",
                str(SCRIPT_DIR / "import_nfse_portal.py"),
                str(out_path),
            ]
            if dry_run:
                imp.append("--dry-run")
            print("Running importer…")
            subprocess.run(imp, cwd=str(PROJECT_ROOT))
        except Exception as e:
            print(f"Portal import failed (continuing to refresh): {e}")
        print()

    # ── Step 2: intelligence refresh — ALWAYS runs ──────────────────────────────
    # Dedup new imports against existing + recompute every payment link/status.
    print("=" * 60)
    refresh = [
        sys.executable,
        "-X",
        "utf8",
        str(SCRIPT_DIR / "refresh_nf_intelligence.py"),
    ]
    if not dry_run:
        refresh.append("--apply")
    result = subprocess.run(refresh, cwd=str(PROJECT_ROOT))
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
