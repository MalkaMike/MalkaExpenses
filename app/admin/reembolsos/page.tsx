import Link from "next/link";
import { ChevronLeft, Briefcase, Shield } from "lucide-react";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { formatBRL, formatInt } from "@/lib/format";
import { ReembolsosClient, type ReembolsoRow, type TagSummary } from "./reembolsos-client";

export const dynamic = "force-dynamic";

type TagRow = { id: string; slug: string; name: string; color: string; icon: string };
type ReimbDb = {
  id: string;
  transaction_id: string;
  tag_id: string;
  status: "pending" | "submitted" | "reimbursed" | "declined";
  reimbursement_amount: number | null;
  submitted_at: string | null;
  reimbursed_at: string | null;
  notes: string | null;
  created_at: string;
};

export default async function ReembolsosPage({
  searchParams
}: {
  searchParams: Promise<{ tag?: string; status?: string }>;
}) {
  if ((await getRole()) !== "admin") {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted">Acesso restrito.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const sb = serverClient();

  // Tags + their pending totals
  const { data: tags } = await sb
    .from("reimbursement_tags")
    .select("id, slug, name, color, icon")
    .order("slug");
  const tagList = (tags ?? []) as TagRow[];

  // Default to "kenlo" if no tag selected
  const activeTag = sp.tag ?? tagList[0]?.slug ?? "kenlo";
  const activeTagRow = tagList.find((t) => t.slug === activeTag) ?? tagList[0];
  const activeStatus = (sp.status ?? "all") as
    | "all"
    | "pending"
    | "submitted"
    | "reimbursed"
    | "declined";

  // Per-tag summary (count + sum by status) for the tab badges
  const summaries: Record<string, TagSummary> = {};
  for (const t of tagList) {
    const { data: rs } = await sb
      .from("transaction_reimbursements")
      .select("transaction_id, status, reimbursement_amount")
      .eq("tag_id", t.id);
    let pendingCount = 0,
      pendingSum = 0,
      reimbursedCount = 0,
      reimbursedSum = 0;
    // Need real_amounts for rows where reimbursement_amount is NULL
    const txIds = (rs ?? []).map((r) => (r as ReimbDb).transaction_id);
    const realAmtById = new Map<string, number>();
    if (txIds.length > 0) {
      for (let i = 0; i < txIds.length; i += 200) {
        const slice = txIds.slice(i, i + 200);
        const { data: txs } = await sb
          .from("transactions")
          .select("id, real_amount")
          .in("id", slice);
        for (const t of txs ?? []) {
          realAmtById.set(t.id as string, Math.abs(Number(t.real_amount)));
        }
      }
    }
    for (const r of rs ?? []) {
      const reimbAmt = (r as ReimbDb).reimbursement_amount;
      const amt =
        reimbAmt != null ? Math.abs(Number(reimbAmt)) : realAmtById.get((r as ReimbDb).transaction_id) ?? 0;
      if ((r as ReimbDb).status === "pending" || (r as ReimbDb).status === "submitted") {
        pendingCount++;
        pendingSum += amt;
      } else if ((r as ReimbDb).status === "reimbursed") {
        reimbursedCount++;
        reimbursedSum += amt;
      }
    }
    summaries[t.slug] = { pendingCount, pendingSum, reimbursedCount, reimbursedSum };
  }

  // Detailed rows for the active tag + status filter
  let query = sb
    .from("transaction_reimbursements")
    .select(
      "id, transaction_id, tag_id, status, reimbursement_amount, submitted_at, reimbursed_at, notes, created_at"
    )
    .eq("tag_id", activeTagRow?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(500);
  if (activeStatus !== "all") query = query.eq("status", activeStatus);
  const { data: reimbs } = await query;

  // Fetch the related transactions in one batch
  const tids = (reimbs ?? []).map((r) => (r as ReimbDb).transaction_id);
  type TxJoin = {
    id: string;
    date: string;
    description_clean: string | null;
    description_raw: string;
    real_amount: number;
    account_id: string;
    category_id: string | null;
  };
  const txMap = new Map<string, TxJoin>();
  if (tids.length > 0) {
    for (let i = 0; i < tids.length; i += 200) {
      const slice = tids.slice(i, i + 200);
      const { data: txs } = await sb
        .from("transactions")
        .select("id, date, description_clean, description_raw, real_amount, account_id, category_id")
        .in("id", slice);
      for (const t of txs ?? []) txMap.set(t.id as string, t as TxJoin);
    }
  }

  const [{ data: accs }, { data: cats }] = await Promise.all([
    sb.from("accounts").select("id, name").eq("is_archived", false),
    sb.from("categories").select("id, name")
  ]);
  const accNameById = new Map<string, string>();
  for (const a of accs ?? []) accNameById.set(a.id as string, a.name as string);
  const catNameById = new Map<string, string>();
  for (const c of cats ?? []) catNameById.set(c.id as string, c.name as string);

  const rows: ReembolsoRow[] = (reimbs ?? []).map((r) => {
    const reimb = r as ReimbDb;
    const tx = txMap.get(reimb.transaction_id);
    const realAmt = tx ? Math.abs(Number(tx.real_amount)) : 0;
    const claimAmt =
      reimb.reimbursement_amount != null
        ? Math.abs(Number(reimb.reimbursement_amount))
        : realAmt;
    return {
      id: reimb.id,
      transactionId: reimb.transaction_id,
      status: reimb.status,
      claimAmount: claimAmt,
      transactionAmount: realAmt,
      submittedAt: reimb.submitted_at,
      reimbursedAt: reimb.reimbursed_at,
      notes: reimb.notes,
      createdAt: reimb.created_at,
      description: tx?.description_clean ?? tx?.description_raw ?? "—",
      date: tx?.date ?? "",
      accountName: tx ? accNameById.get(tx.account_id) ?? "—" : "—",
      categoryName: tx?.category_id ? catNameById.get(tx.category_id) ?? "—" : "—"
    };
  });

  return (
    <div className="px-4 pt-6 max-w-4xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Reembolsos</h1>
        <p className="text-xs text-muted mt-1">
          Despesas marcadas com tags que serão devolvidas — Kenlo, Laik, Plano de Saúde.
        </p>
      </header>

      {/* Tag tabs */}
      <nav className="flex flex-wrap gap-2 mb-5">
        {tagList.map((t) => {
          const sum = summaries[t.slug];
          const active = t.slug === activeTag;
          const Icon = t.icon === "shield" ? Shield : Briefcase;
          return (
            <Link
              key={t.id}
              href={`/admin/reembolsos?tag=${t.slug}`}
              className={`px-4 py-3 rounded-2xl border transition flex items-center gap-3 min-w-[170px]
                ${active
                  ? "bg-fg text-bg border-fg"
                  : "bg-card text-fg border-border hover:border-fg/30"}`}
            >
              <div
                className={`w-9 h-9 rounded-xl ${
                  active ? "bg-bg/20" : "bg-fg/5"
                } flex items-center justify-center`}
              >
                <Icon size={16} />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t.name}</p>
                <p
                  className={`text-[11px] tabular-nums ${active ? "opacity-70" : "text-muted"}`}
                >
                  {formatBRL(sum?.pendingSum ?? 0)} pendente
                </p>
              </div>
              {(sum?.pendingCount ?? 0) > 0 && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${
                    active ? "bg-bg/20 text-bg" : "bg-warning/15 text-warning"
                  }`}
                >
                  {formatInt(sum?.pendingCount ?? 0)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {activeTagRow && (
        <ReembolsosClient
          tagSlug={activeTagRow.slug}
          tagName={activeTagRow.name}
          activeStatus={activeStatus}
          summary={summaries[activeTagRow.slug] ?? { pendingCount: 0, pendingSum: 0, reimbursedCount: 0, reimbursedSum: 0 }}
          rows={rows}
        />
      )}
    </div>
  );
}
