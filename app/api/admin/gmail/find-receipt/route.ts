import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/gmail/oauth";
import { findReceiptsForTransaction } from "@/lib/gmail/search";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  transaction_id: z.string().uuid(),
  merchant_name: z.string().min(1).max(200),
  // Force re-fetch even if we have cached matches
  refresh: z.boolean().optional()
});

// POST /api/admin/gmail/find-receipt
// Searches the connected Gmail for nota fiscal / invoice emails matching a
// transaction. Caches matches in transaction_receipts. Returns the sorted
// list of matches with Gmail URLs.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const { transaction_id, merchant_name, refresh } = parsed.data;

  const sb = serverClient();

  // Fetch the transaction date
  const { data: tx } = await sb
    .from("transactions")
    .select("id, date, real_amount")
    .eq("id", transaction_id)
    .maybeSingle();
  if (!tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  // Return cached results unless refresh=true
  if (!refresh) {
    const { data: cached } = await sb
      .from("transaction_receipts")
      .select("*")
      .eq("transaction_id", transaction_id)
      .order("match_score", { ascending: false });
    if (cached && cached.length > 0) {
      return NextResponse.json({
        cached: true,
        matches: cached.map((r) => ({
          id: r.id,
          gmailMessageId: r.gmail_message_id,
          gmailThreadId: r.gmail_thread_id,
          subject: r.subject,
          fromEmail: r.from_email,
          fromName: r.from_name,
          sentAt: r.sent_at,
          hasAttachment: r.has_attachment,
          attachmentCount: r.attachment_count,
          matchScore: Number(r.match_score),
          matchReason: r.match_reason,
          confirmed: r.confirmed,
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${r.gmail_message_id}`
        }))
      });
    }
  }

  // Live search
  const cred = await getValidAccessToken();
  if (!cred) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  let matches;
  try {
    matches = await findReceiptsForTransaction({
      accessToken: cred.accessToken,
      merchantName: merchant_name,
      date: tx.date as string,
      dayWindow: 3,
      max: 5
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Gmail search failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Persist matches (replace any existing)
  if (refresh) {
    await sb.from("transaction_receipts").delete().eq("transaction_id", transaction_id);
  }
  if (matches.length > 0) {
    await sb.from("transaction_receipts").upsert(
      matches.map((m) => ({
        transaction_id,
        gmail_message_id: m.gmailMessageId,
        gmail_thread_id: m.gmailThreadId,
        subject: m.subject,
        from_email: m.fromEmail,
        from_name: m.fromName,
        sent_at: m.sentAt,
        has_attachment: m.hasAttachment,
        attachment_count: m.attachmentCount,
        match_score: m.matchScore,
        match_reason: m.matchReason
      })),
      { onConflict: "transaction_id,gmail_message_id" }
    );
  }

  return NextResponse.json({ cached: false, matches });
}
