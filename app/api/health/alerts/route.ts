import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MissingMonth = {
  account_id: string;
  account_name: string;
  missing: string[]; // YYYY-MM strings
};

type FailedImport = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

// GET /api/health/alerts
// Returns a summary of actionable issues across all accounts.
export async function GET() {
  // Admin-only: these alerts (pending review, missing months, failed imports)
  // are operational admin concerns. Household must not see them — it would hint
  // at the hidden ledger. 404 (not 401) so the endpoint's existence isn't leaked.
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sb = serverClient();

  // ── 1) Pending review count ─────────────────────────────────────────────────
  const { count: pendingReview } = await sb
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review");

  // ── 2) Missing months per account ───────────────────────────────────────────
  // For each active account, find YYYY-MM months between first transaction and
  // today that have zero transactions. Any gap ≥ 1 month is surfaced.
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name")
    .eq("is_archived", false);

  const missingMonths: MissingMonth[] = [];

  if (accounts && accounts.length > 0) {
    const { data: txAgg } = await sb
      .from("transactions")
      .select("account_id, date")
      .in("account_id", accounts.map((a) => a.id))
      .order("date");

    // Group dates by account
    const byAccount = new Map<string, string[]>();
    for (const t of txAgg ?? []) {
      const month = t.date.slice(0, 7);
      const list = byAccount.get(t.account_id) ?? [];
      list.push(month);
      byAccount.set(t.account_id, list);
    }

    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    for (const acc of accounts) {
      const months = byAccount.get(acc.id);
      if (!months || months.length === 0) continue; // no transactions at all → not an alert

      const uniqueMonths = new Set(months);
      const minMonth = months[0]; // already sorted
      const missing: string[] = [];

      // Walk from first month to current month
      let cursor = minMonth;
      while (cursor <= currentMonth) {
        if (!uniqueMonths.has(cursor)) {
          missing.push(cursor);
        }
        // Advance by 1 month
        const [y, m] = cursor.split("-").map(Number);
        const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        cursor = next;
      }

      if (missing.length > 0) {
        missingMonths.push({
          account_id: acc.id,
          account_name: acc.name,
          missing
        });
      }
    }
  }

  // ── 3) Failed imports (last 30 days) ────────────────────────────────────────
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: failedImports } = await sb
    .from("statement_imports")
    .select("id, file_name, created_at")
    .eq("status", "failed")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

  const failed: FailedImport[] = (failedImports ?? []).map((f) => ({
    id: f.id,
    file_name: f.file_name,
    uploaded_at: f.created_at
  }));

  // ── Total alert count (for the badge) ───────────────────────────────────────
  const totalAlerts =
    (pendingReview ?? 0) +
    missingMonths.reduce((s, m) => s + m.missing.length, 0) +
    failed.length;

  return NextResponse.json({
    total: totalAlerts,
    pending_review: pendingReview ?? 0,
    missing_months: missingMonths,
    failed_imports: failed
  });
}
