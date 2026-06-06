import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

const Schema = z.object({
  kind: z.enum(["rule", "term", "policy"]),
  id: z.string().uuid(),
  human_confirmed: z.boolean(),
});

// POST /api/admin/health/policy/confirm
// Body: { kind: "rule"|"term"|"policy", id, human_confirmed }
// Flips the human_confirmed flag on a coverage rule, a policy term, or the policy itself.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }
  const { kind, id, human_confirmed } = parsed.data;

  const table =
    kind === "rule"
      ? "policy_coverage_rules"
      : kind === "term"
      ? "policy_terms"
      : "insurance_policies";

  const sb = serverClient();
  const { data, error } = await sb
    .from(table)
    .update({ human_confirmed })
    .eq("id", id)
    .select("id, human_confirmed")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
