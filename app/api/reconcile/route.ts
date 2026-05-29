import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { runReconcileScan } from "@/lib/reconciliation/run";

export const runtime = "nodejs";
export const maxDuration = 60;

// Normalize a Supabase nested relation that may arrive as object | array | null.
function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

// ── GET /api/reconcile ────────────────────────────────────────────────────────
// Returns the list of credit-card statements available to link against (used by
// the manual "link to CC statement" picker in the transaction editor).
export async function GET() {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const sb = serverClient();
  const { data, error } = await sb
    .from("statement_imports")
    .select("id, account_id, closing_balance, due_date, accounts!inner(name, cc_issuer, type)")
    .not("closing_balance", "is", null)
    .eq("accounts.type", "credit_card")
    .order("uploaded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statements = (data ?? []).map((r) => {
    const acc = one(r.accounts as { name: string; cc_issuer: string | null } | { name: string; cc_issuer: string | null }[] | null);
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      accountName: acc?.name ?? "—",
      closingBalance: r.closing_balance === null ? null : Number(r.closing_balance),
      dueDate: (r.due_date as string | null) ?? null
    };
  });

  return NextResponse.json({ statements });
}

const Body = z.union([
  // Manual mode: force-link a specific bank tx to a specific CC statement.
  z.object({
    bankTransactionId: z.string().uuid(),
    ccStatementImportId: z.string().uuid()
  }),
  // Auto mode: scan for matches. Optional accountId scopes to one bank account.
  z.object({
    accountId: z.string().uuid().optional()
  })
]);

// ── POST /api/reconcile ───────────────────────────────────────────────────────
// Two modes (discriminated by body shape):
//   • { bankTransactionId, ccStatementImportId } → manual link (user confirmed)
//   • { accountId? }                              → auto-scan + auto-link singles
export async function POST(req: NextRequest) {
  if ((await getRole()) !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const sb = serverClient();

  // Resolve the cartao_pagamento category once (linked bank lines get it).
  const { data: payCat } = await sb
    .from("categories")
    .select("id")
    .eq("slug", "cartao_pagamento")
    .single();
  const payCatId = payCat?.id as string | undefined;

  // ── Manual mode ─────────────────────────────────────────────────────────────
  if ("bankTransactionId" in parsed.data) {
    const { bankTransactionId, ccStatementImportId } = parsed.data;

    const { error: recErr } = await sb.from("cc_reconciliations").insert({
      bank_transaction_id: bankTransactionId,
      cc_statement_import_id: ccStatementImportId,
      match_confidence: 1.0,
      user_confirmed: true
    });
    if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 });

    const { error: txErr } = await sb
      .from("transactions")
      .update({
        is_transfer: true,
        status: "user_edited",
        ...(payCatId ? { category_id: payCatId } : {})
      })
      .eq("id", bankTransactionId);
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

    return NextResponse.json({ linked: true });
  }

  // ── Auto-scan mode ──────────────────────────────────────────────────────────
  const result = await runReconcileScan(sb, parsed.data.accountId);
  return NextResponse.json(result);
}
