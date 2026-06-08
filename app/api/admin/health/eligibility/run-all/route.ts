import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { runOneEligibility } from "@/lib/eligibility/run-one";

export const runtime = "nodejs";
// Hobby plan: 60s max. Each Gemini call takes 10-25s, concurrency 3.
// Default limit=6 (2 batches × ~25s = ~50s) — safe headroom.
// Callers re-invoke with { offset: N } until hasMore=false.
export const maxDuration = 60;

// ============================================================================
// POST /api/admin/health/eligibility/run-all
//
// Bulk-runs the eligibility engine over nota_fiscais where is_medical=true.
// Concurrency: 3 per batch. Paginated so the route fits in 60s (Hobby plan).
//
// Body:
//   offset  — start index (default 0)
//   limit   — NFs to process this call (default 6)
//   force   — when true, overwrites manually-confirmed rows (default false)
//
// Response:
//   { total, offset, limit, processed, skipped_confirmed, errors, hasMore,
//     nextOffset, results[] }
//
// Client re-calls with { offset: nextOffset } until hasMore=false.
// Each call is independent — re-running with force=false auto-skips confirmed rows.
// ============================================================================

export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: { offset?: number; limit?: number; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body OK
  }

  const offset = Math.max(0, Number(body.offset ?? 0));
  const limit  = Math.min(12, Math.max(1, Number(body.limit  ?? 6))); // cap at 12 — safety
  const force  = !!body.force;

  const sb = serverClient();

  // Fetch ALL eligible NF IDs (ordered oldest-first for correct annual-limit math).
  const { data: nfRows, error: nfErr } = await sb
    .from("nota_fiscais")
    .select("id")
    .or("is_medical.eq.true,is_reimbursable.eq.true")
    .order("emission_date", { ascending: true });

  if (nfErr) {
    return NextResponse.json({ error: nfErr.message }, { status: 500 });
  }

  const allIds  = (nfRows ?? []).map((r) => r.id as string);
  const total   = allIds.length;
  const page    = allIds.slice(offset, offset + limit);
  const hasMore = offset + limit < total;
  const nextOffset = hasMore ? offset + limit : total;

  // Process the page with concurrency 3.
  const CONCURRENCY = 3;
  const results = [];

  for (let i = 0; i < page.length; i += CONCURRENCY) {
    const batch   = page.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((id) => runOneEligibility(id, { force }))
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        // runOneEligibility never rejects — but guard anyway
        results.push({
          nf_id:  batch[j],
          status: "error" as const,
          error:  r.reason?.message ?? "unknown",
        });
      }
    }
  }

  const processed         = results.filter((r) => r.status === "processed").length;
  const skipped_confirmed = results.filter((r) => r.status === "skipped_confirmed").length;
  const not_found         = results.filter((r) => r.status === "not_found").length;
  const no_policy         = results.filter((r) => r.status === "no_active_policy").length;
  const errors            = results.filter((r) => r.status === "error").length;

  // Only audit when this is the final page or on errors, to avoid spam.
  if (!hasMore || errors > 0) {
    await writeAudit("health.eligibility.run_all", {
      newValue: { total, offset, limit, processed, skipped_confirmed, errors, force },
    });
  }

  return NextResponse.json({
    total,
    offset,
    limit,
    processed,
    skipped_confirmed,
    not_found,
    no_active_policy: no_policy,
    errors,
    hasMore,
    nextOffset,
    results,
  });
}
