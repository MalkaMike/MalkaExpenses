import Link from "next/link";
import { Briefcase, Shield } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { formatBRL, formatInt } from "@/lib/format";
import { fromDb } from "@/lib/money";
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

  // Tags + their pending totals. Excludes tags that aren't real reimbursement
  // claims (e.g. "suspeito" — an informational flag, no claim status to track).
  const { data: tags } = await sb
    .from("reimbursement_tags")
    .select("id, slug, name, color, icon")
    .eq("tracks_reimbursement", true)
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
          realAmtById.set(t.id as string, Math.abs(fromDb(Number(t.real_amount))));
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
    const realAmt = tx ? Math.abs(fromDb(Number(tx.real_amount))) : 0;
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
    <>
    <PageHeader title="Reembolsos" crumbs={[{ href: "/admin", label: "Admin" }]} />
    <div className="px-4 pt-5 max-w-4xl mx-auto pb-28">
      <p className="text-sm text-on-surface-variant mb-5">Despesas marcadas para devolver — Kenlo, Laik, Plano de Saúde.</p>

      {/* Tag entity cards — Stitch style */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {tagList.map((t) => {
          const sum = summaries[t.slug];
          const active = t.slug === activeTag;
          const Icon = t.icon === "shield" ? Shield : Briefcase;
          // Entity color per tag
          const colors: Record<string, { bg: string; iconBg: string; iconColor: string; bar: string }> = {
            kenlo:     { bg: "#eff6ff", iconBg: "#dbeafe", iconColor: "#2563eb", bar: "#2563eb" },
            laik:      { bg: "#faf5ff", iconBg: "#ede9fe", iconColor: "#7c3aed", bar: "#7c3aed" },
            insurance: { bg: "#f0fdf4", iconBg: "#dcfce7", iconColor: "#16a34a", bar: "#16a34a" }
          };
          const c = colors[t.slug] ?? { bg: "#f5f3f0", iconBg: "#e4e2df", iconColor: "#45464d", bar: "#45464d" };
          const pendingPct = (sum?.pendingCount ?? 0) > 0
            ? Math.round(((sum?.pendingCount ?? 0) / Math.max((sum?.pendingCount ?? 0) + (sum?.reimbursedCount ?? 0), 1)) * 100)
            : 0;
          return (
            <Link
              key={t.id}
              href={`/admin/reembolsos?tag=${t.slug}`}
              className={`p-4 rounded-xl border transition-all soft-ambient-shadow flex flex-col gap-3 cursor-pointer ${
                active
                  ? "border-primary/20 ring-1 ring-primary bg-surface-container-lowest"
                  : "border-outline-variant bg-surface-container-lowest hover:border-primary/20"
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: c.iconBg }}
                >
                  <Icon size={18} style={{ color: c.iconColor }} />
                </div>
                {(sum?.pendingCount ?? 0) > 0 && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: c.iconBg, color: c.iconColor }}
                  >
                    {formatInt(sum?.pendingCount ?? 0)} pend.
                  </span>
                )}
              </div>
              <div>
                <p className="font-semibold text-on-surface">{t.name}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Pendente: <span className="tabular-nums font-medium text-on-surface">{formatBRL(sum?.pendingSum ?? 0)}</span>
                </p>
              </div>
              {/* Progress bar */}
              <div className="h-1 w-full bg-surface-container rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: `${pendingPct}%`, background: c.bar }}
                />
              </div>
            </Link>
          );
        })}
      </div>

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
  </>
  );
}
