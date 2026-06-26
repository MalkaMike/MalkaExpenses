import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";
import { fromDb } from "@/lib/money";
import {
  NotasEncontradasClient,
  type FoundReceipt,
  type DayGroup,
  type ReimbursementTag,
  type Category
} from "./notas-encontradas-client";

export const dynamic = "force-dynamic";

// ============================================================================
// /admin/notas-encontradas — the daily nota-fiscal digest.
//
// Shows every Gmail-found receipt the robot located that the admin hasn't
// triaged yet (transaction_receipts.confirmed IS NULL), grouped by the day it
// was found, newest first. The admin accepts ("esta é a nota") or dismisses
// each — or accepts a whole day in one click.
//
// Also shows the merchant cluster + current category per receipt, with an
// inline category picker. Changing category here calls bulk_categorize_merchant
// which propagates to ALL past/future transactions of that merchant.
// ============================================================================
export default async function NotasEncontradasPage() {
  const role = await getRole();
  if (role !== "admin") redirect("/login?next=/admin/notas-encontradas");

  const sb = serverClient();
  await preloadClusters();

  // 1) Pull untriaged found-receipts (newest first).
  const { data: receipts } = await sb
    .from("transaction_receipts")
    .select(
      "id, transaction_id, subject, from_name, from_email, sent_at, has_attachment, attachment_count, confidence, match_source, match_reason, match_snippet, amount_brl, created_at, gmail_message_id"
    )
    .is("confirmed", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = receipts ?? [];

  // 2) Resolve the related transactions.
  //    Also fetch shared_amount + is_transfer + status so we can filter
  //    out receipts for hidden or transfer transactions.
  const txIds = [...new Set(rows.map((r) => r.transaction_id as string))];
  const txById = new Map<
    string,
    { date: string; description_raw: string; real_amount: number; account_id: string; visible: boolean }
  >();
  if (txIds.length > 0) {
    const { data: txs } = await sb
      .from("transactions")
      .select("id, date, description_raw, real_amount, account_id, shared_amount, is_transfer, status")
      .in("id", txIds);
    for (const t of txs ?? []) {
      const isHidden = Number(t.shared_amount) === 0 && t.status !== "pending_review";
      const visible = !t.is_transfer && !isHidden;
      txById.set(t.id as string, {
        date: t.date as string,
        description_raw: t.description_raw as string,
        real_amount: fromDb(Number(t.real_amount)),
        account_id: t.account_id as string,
        visible
      });
    }
  }

  // 3) Load support data in parallel: accounts, reimbursement tags, categories.
  const [{ data: accounts }, { data: reimbTags }, { data: categoryRows }] = await Promise.all([
    sb.from("accounts").select("id, name"),
    sb.from("reimbursement_tags").select("id, slug, name, color, icon").order("name"),
    sb.from("categories").select("id, name, slug").order("name")
  ]);
  const accountNameById = new Map<string, string>();
  for (const a of accounts ?? []) accountNameById.set(a.id as string, a.name as string);

  // 4) Build display rows, dropping hidden/transfer transactions.
  //    Capture canonical_key per item so we can look up category_id next.
  type RawItem = FoundReceipt & { merchantKey: string };
  const rawItems: RawItem[] = [];
  for (const r of rows) {
    const tx = txById.get(r.transaction_id as string);
    if (!tx || !tx.visible) continue;
    const cluster = clusterFor(tx.description_raw);
    rawItems.push({
      receiptId: r.id as string,
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${r.gmail_message_id}`,
      subject: (r.subject as string) ?? "(sem assunto)",
      fromName: (r.from_name as string) ?? null,
      fromEmail: (r.from_email as string) ?? null,
      sentAt: (r.sent_at as string) ?? null,
      hasAttachment: !!r.has_attachment,
      attachmentCount: Number(r.attachment_count) || 0,
      confidence: (r.confidence as string) ?? "high",
      matchSource: (r.match_source as string) ?? null,
      matchSnippet: (r.match_snippet as string) ?? null,
      amountBrl: r.amount_brl != null ? Number(r.amount_brl) : null,
      foundAt: r.created_at as string,
      txId: r.transaction_id as string,
      txDate: tx.date,
      merchantName: cluster.name,
      merchantKey: cluster.key,
      txAmount: tx.real_amount,
      accountName: accountNameById.get(tx.account_id) ?? "—",
      categoryId: null  // filled in step 5
    });
  }

  // 5) Look up the current category_id per merchant cluster in one query.
  //    merchant_clusters.category_id is what bulk_categorize_merchant writes to.
  const distinctKeys = [...new Set(rawItems.map((it) => it.merchantKey))];
  const categoryIdByKey = new Map<string, string>();
  if (distinctKeys.length > 0) {
    const { data: clusterMeta } = await sb
      .from("merchant_clusters")
      .select("canonical_key, category_id")
      .in("canonical_key", distinctKeys);
    for (const c of clusterMeta ?? []) {
      if (c.category_id) {
        categoryIdByKey.set(c.canonical_key as string, c.category_id as string);
      }
    }
  }

  // Attach category_id to each item (all receipts from same merchant share it).
  const items: FoundReceipt[] = rawItems.map((it) => ({
    ...it,
    categoryId: categoryIdByKey.get(it.merchantKey) ?? null
  }));

  // 6) Group by day found.
  const groupMap = new Map<string, FoundReceipt[]>();
  for (const it of items) {
    const day = it.foundAt.slice(0, 10);
    if (!groupMap.has(day)) groupMap.set(day, []);
    groupMap.get(day)!.push(it);
  }
  const groups: DayGroup[] = [...groupMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, items: list }));

  return (
    <>
      <PageHeader
        title="Notas fiscais encontradas"
        crumbs={[{ href: "/admin", label: "Admin" }]}
      />
      <div className="px-4 pt-5 max-w-3xl mx-auto pb-28">
        <p className="text-xs text-on-surface-variant mb-5">
          O robô busca no Gmail toda manhã. Aqui ficam as notas que ele achou e
          você ainda não revisou — aceite as corretas (saem da fila) ou descarte.
          Você pode conferir e ajustar a categoria do fornecedor direto aqui.
        </p>
        <NotasEncontradasClient
          groups={groups}
          reimbursementTags={(reimbTags ?? []) as ReimbursementTag[]}
          categories={(categoryRows ?? []) as Category[]}
        />
      </div>
    </>
  );
}
