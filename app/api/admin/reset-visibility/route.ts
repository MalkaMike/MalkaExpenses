import { NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/reset-visibility
//
// One-time operation: makes 100% of transactions visible to the household
// by setting shared_amount = real_amount for every non-fake row, and moving
// pending_review → user_edited so they leave the inbox counter.
//
// Delegates to the reset_all_visibility() Postgres function (migration 0024)
// so the entire operation is a single SQL UPDATE — no batching, no N+1.
// Idempotent: re-running is safe (IS DISTINCT FROM guard).
// Auth: admin only.
export async function POST() {
  await requireAdmin();
  const sb = serverClient();

  const { data: affected, error } = await sb.rpc("reset_all_visibility");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const count = Number(affected ?? 0);

  await writeAudit("admin.reset_visibility", {
    newValue: { affected: count, note: "shared_amount reset to real_amount for all non-fake rows" }
  });

  return NextResponse.json({
    ok: true,
    affected: count,
    message: `${count} transações agora 100% visíveis`
  });
}
