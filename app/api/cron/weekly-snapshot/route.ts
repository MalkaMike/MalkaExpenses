import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/cron/weekly-snapshot
// Captures a frozen JSONB snapshot of transactions + accounts + clusters every
// week. Auth: shared secret in Authorization header (Bearer CRON_SECRET).
//
// Resilience design: if Pluggy ever disconnects (token revoked, banks change
// terms, app trial expires, etc.), we never lose what we already collected —
// this endpoint freezes the world weekly into data_snapshots.
//
// IMMUTABLE INSERTS: each run appends a new row (multiple snapshots per week
// are intentional — history of attempts beats overwrite of last-good).
//
// Failure model: if ANY required table fails to read, the snapshot is marked
// `degraded` with the error, but still committed so we have a partial cold
// copy. Cluster failure does NOT silently produce a clean-looking backup.
//
// Vercel cron schedule lives in vercel.json (Monday 04:00 UTC).

type TableRows = Record<string, unknown>[];

async function loadAll(
  sb: ReturnType<typeof serverClient>,
  table: string
): Promise<{ rows: TableRows; error: string | null }> {
  const rows: TableRows = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order("id", { ascending: true })  // stable order across batches
      .range(off, off + 999);
    if (error) return { rows, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...(data as TableRows));
    if (data.length < 1000) break;
    off += 1000;
  }
  return { rows, error: null };
}

export async function GET(req: NextRequest) {
  // Authenticate cron call
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = serverClient();

  // Compute "week_of" = Monday of the current week (UTC)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun..6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const weekOf = monday.toISOString().slice(0, 10);

  const errors: Record<string, string> = {};

  const [txRes, accRes, clusterRes] = await Promise.all([
    loadAll(sb, "transactions"),
    loadAll(sb, "accounts"),
    loadAll(sb, "merchant_clusters")
  ]);

  if (txRes.error) errors.transactions = txRes.error;
  if (accRes.error) errors.accounts = accRes.error;
  if (clusterRes.error) errors.merchant_clusters = clusterRes.error;

  // Hard failure: transactions + accounts MUST succeed. Clusters can be empty
  // (table didn't exist yet in older deployments), but its error is recorded.
  if (txRes.error || accRes.error) {
    return NextResponse.json(
      {
        error: "essential tables failed to read",
        details: errors,
        week_of: weekOf
      },
      { status: 500 }
    );
  }

  const txs = txRes.rows as Array<{
    real_amount: number;
    shared_amount: number;
    source?: string | null;
    category_id?: string | null;
  }>;

  const degraded = Object.keys(errors).length > 0;
  const stats = {
    transaction_count: txRes.rows.length,
    account_count: accRes.rows.length,
    cluster_count: clusterRes.rows.length,
    total_real_balance: txs.reduce((s, t) => s + Number(t.real_amount), 0),
    total_shared_balance: txs.reduce((s, t) => s + Number(t.shared_amount), 0),
    categorized_count: txs.filter((t) => t.category_id).length,
    pluggy_source_count: txs.filter((t) => t.source === "pluggy").length,
    pdf_source_count: txs.filter((t) => t.source === "pdf").length,
    degraded,
    errors: degraded ? errors : null,
    snapshot_size_kb: Math.round(
      JSON.stringify({
        transactions: txRes.rows,
        accounts: accRes.rows,
        merchant_clusters: clusterRes.rows
      }).length / 1024
    )
  };

  // IMMUTABLE INSERT — never overwrites previous snapshots for the same week.
  // Multiple attempts per week are allowed and intentional.
  const { error: insertErr } = await sb.from("data_snapshots").insert({
    week_of: weekOf,
    transactions: txRes.rows,
    accounts: accRes.rows,
    merchant_clusters: clusterRes.rows,
    stats,
    triggered_by: "cron"
  });

  if (insertErr) {
    return NextResponse.json(
      { error: `Snapshot insert failed: ${insertErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    week_of: weekOf,
    ...stats
  });
}
