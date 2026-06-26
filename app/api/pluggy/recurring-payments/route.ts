import { NextResponse } from "next/server";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getRecurringPayments, type RecurringPayment } from "@/lib/pluggy/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const role = await getRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = serverClient();
  const { data: accounts } = await sb
    .from("accounts")
    .select("pluggy_item_id, name")
    .not("pluggy_item_id", "is", null)
    .eq("is_archived", false);

  // Deduplicate — one Pluggy item can have multiple accounts (e.g. checking + CC).
  const itemIds = [...new Set((accounts ?? []).map((a) => a.pluggy_item_id as string))];

  const results = await Promise.allSettled(itemIds.map((id) => getRecurringPayments(id)));

  const all: RecurringPayment[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Merge near-duplicate descriptions across items, sort by abs average amount desc.
  all.sort((a, b) => Math.abs(b.averageAmount) - Math.abs(a.averageAmount));

  return NextResponse.json({ recurringPayments: all });
}
