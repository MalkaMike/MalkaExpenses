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

// GET /api/health/alerts
// Returns a summary of actionable issues across all accounts.
export async function GET() {
  // Admin-only: these alerts (pending review, missing months) are operational
  // admin concerns. Household must not see them — it would hint at the hidden
  // ledger. 404 (not 401) so the endpoint's existence isn't leaked.
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sb = serverClient();

  // One parallel batch: pending-review count, active accounts, and the
  // distinct (account, month) pairs via SQL (migration 0035). The old version
  // fetched every transaction's date ordered ascending — PostgREST caps
  // responses at 1000 rows, so the detector only ever saw the OLDEST 1000
  // rows and flagged every recent month as a false gap.
  const [pendingRes, accountsRes, presenceRes] = await Promise.all([
    sb
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review"),
    sb.from("accounts").select("id, name").eq("is_archived", false),
    sb.rpc("account_month_presence")
  ]);
  if (pendingRes.error) console.error("[alerts] pending count failed:", pendingRes.error.message);
  if (accountsRes.error) console.error("[alerts] accounts fetch failed:", accountsRes.error.message);
  if (presenceRes.error) console.error("[alerts] month presence failed:", presenceRes.error.message);

  const pendingReview = pendingRes.count;
  const accounts = accountsRes.data;

  const missingMonths: MissingMonth[] = [];

  if (accounts && accounts.length > 0 && !presenceRes.error) {
    // Group months by account (RPC returns distinct pairs, unordered)
    const byAccount = new Map<string, string[]>();
    for (const t of (presenceRes.data ?? []) as Array<{ account_id: string; month: string }>) {
      const list = byAccount.get(t.account_id) ?? [];
      list.push(t.month);
      byAccount.set(t.account_id, list);
    }
    for (const list of byAccount.values()) list.sort();

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

  // ── Total alert count (for the badge) ───────────────────────────────────────
  const totalAlerts =
    (pendingReview ?? 0) +
    missingMonths.reduce((s, m) => s + m.missing.length, 0);

  return NextResponse.json({
    total: totalAlerts,
    pending_review: pendingReview ?? 0,
    missing_months: missingMonths
  });
}
