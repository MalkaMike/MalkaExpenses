import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { PageHeader } from "@/components/page-header";
import { serverClient } from "@/lib/supabase/server";
import { clusterFor, preloadClusters } from "@/lib/merchants/clusters";
import { NotasEncontradasClient, type FoundReceipt, type DayGroup } from "./notas-encontradas-client";

export const dynamic = "force-dynamic";

// ============================================================================
// /admin/notas-encontradas — the daily nota-fiscal digest.
//
// Shows every Gmail-found receipt the robot located that the admin hasn't
// triaged yet (transaction_receipts.confirmed IS NULL), grouped by the day it
// was found, newest first. The admin accepts ("esta é a nota") or dismisses
// each — or accepts a whole day in one click. Accepting removes it from the
// queue, so this page is always "what's new to review".
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

  // 2) Resolve the related transactions in one query.
  const txIds = [...new Set(rows.map((r) => r.transaction_id as string))];
  const txById = new Map<
    string,
    { date: string; description_raw: string; real_amount: number; account_id: string }
  >();
  if (txIds.length > 0) {
    const { data: txs } = await sb
      .from("transactions")
      .select("id, date, description_raw, real_amount, account_id")
      .in("id", txIds);
    for (const t of txs ?? []) {
      txById.set(t.id as string, {
        date: t.date as string,
        description_raw: t.description_raw as string,
        real_amount: Number(t.real_amount),
        account_id: t.account_id as string
      });
    }
  }

  // 3) Account names.
  const { data: accounts } = await sb.from("accounts").select("id, name");
  const accountNameById = new Map<string, string>();
  for (const a of accounts ?? []) accountNameById.set(a.id as string, a.name as string);

  // 4) Build display rows, dropping any receipt whose transaction vanished.
  const items: FoundReceipt[] = [];
  for (const r of rows) {
    const tx = txById.get(r.transaction_id as string);
    if (!tx) continue;
    items.push({
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
      merchantName: clusterFor(tx.description_raw).name,
      txAmount: tx.real_amount,
      accountName: accountNameById.get(tx.account_id) ?? "—"
    });
  }

  // 5) Group by the day the receipt was found (created_at date).
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
        </p>
        <NotasEncontradasClient groups={groups} />
      </div>
    </>
  );
}
