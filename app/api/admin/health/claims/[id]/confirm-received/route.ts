import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/health/claims/[id]/confirm-received
// Celina confirms she received the emailed claim package.
// Transitions: sent_to_secretary → received_by_secretary
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAnyHealthRole();
  const { id } = await params;
  const sb = serverClient();

  const { data: claim } = await sb
    .from("reimbursement_claims")
    .select("id, lifecycle_state")
    .eq("id", id)
    .maybeSingle();

  if (!claim) return NextResponse.json({ error: "claim not found" }, { status: 404 });
  if (claim.lifecycle_state !== "sent_to_secretary") {
    return NextResponse.json({ error: `cannot confirm-received from state '${claim.lifecycle_state}'` }, { status: 409 });
  }

  const { error } = await sb
    .from("reimbursement_claims")
    .update({ lifecycle_state: "received_by_secretary", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lifecycle_state: "received_by_secretary" });
}
