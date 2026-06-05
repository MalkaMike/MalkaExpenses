import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/gmail/batch-status
//
// Returns the overall search progress: how many expenses we've searched,
// how many we've found receipts for, and how many are still pending.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  const [{ count: total }, { count: searched }, { count: withMatches }, { count: pending }] =
    await Promise.all([
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("is_transfer", false)
        .lt("real_amount", 0),
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("is_transfer", false)
        .lt("real_amount", 0)
        .not("gmail_searched_at", "is", null),
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("is_transfer", false)
        .lt("real_amount", 0)
        .gt("gmail_match_count", 0),
      sb
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .is("gmail_searched_at", null)
        .eq("is_transfer", false)
        .lt("real_amount", 0)
    ]);

  return NextResponse.json({
    totalExpenses: total ?? 0,
    searched: searched ?? 0,
    withMatches: withMatches ?? 0,
    pending: pending ?? 0,
    pctSearched: total && total > 0 ? Math.round(((searched ?? 0) / total) * 100) : 0,
    pctHitRate: searched && searched > 0 ? Math.round(((withMatches ?? 0) / searched) * 100) : 0
  });
}
