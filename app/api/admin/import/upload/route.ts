import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { parseOfx } from "@/lib/parsers/ofx";
import { parsePdfStatement } from "@/lib/ai/parse-pdf";

export const runtime = "nodejs";
export const maxDuration = 60; // PDF parsing via Gemini can take ~30s

type PreviewTx = {
  externalId: string | null;
  date: string;
  amount: number;
  description: string;
  type?: string | null;
};

// Upload a statement file → store in Supabase Storage, parse, return preview.
// Supports: OFX/QFX (hand-rolled parser), PDF (Gemini Vision via Vertex AI).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const accountId = form.get("accountId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (typeof accountId !== "string" || !accountId) {
    return NextResponse.json({ error: "missing accountId" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fileType = ["ofx", "qfx"].includes(ext)
    ? "ofx"
    : ext === "pdf"
      ? "pdf"
      : ext === "csv"
        ? "csv"
        : null;
  if (!fileType) {
    return NextResponse.json({ error: `unsupported file type: ${ext}` }, { status: 400 });
  }

  const sb = serverClient();
  const storagePath = `imports/${accountId}/${Date.now()}_${file.name}`;
  const { data: importRow, error: insErr } = await sb
    .from("statement_imports")
    .insert({
      account_id: accountId,
      file_name: file.name,
      file_type: fileType,
      storage_path: storagePath,
      status: "uploaded"
    })
    .select("id")
    .single();
  if (insErr || !importRow) {
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  // Stash a copy in Storage best-effort (works once 'statements' bucket exists)
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await sb.storage.from("statements").upload(storagePath, buf, {
      contentType: file.type || undefined,
      upsert: false
    });
  } catch {
    // optional
  }

  let preview: {
    openingBalance: number | null;
    closingBalance: number | null;
    currency: string | null;
    count: number;
    transactions: PreviewTx[];
    bankHint?: string | null;
    accountTypeHint?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    dueDate?: string | null;
  };

  try {
    if (fileType === "ofx") {
      const text = await file.text();
      const parsed = parseOfx(text);
      preview = {
        openingBalance: parsed.openingBalance,
        closingBalance: parsed.closingBalance,
        currency: parsed.currency,
        count: parsed.transactions.length,
        transactions: parsed.transactions.slice(0, 500)
      };
    } else if (fileType === "pdf") {
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parsePdfStatement(buf, file.type || "application/pdf");
      preview = {
        openingBalance: null,
        closingBalance: parsed.closing_balance,
        currency: parsed.currency,
        count: parsed.transactions.length,
        transactions: parsed.transactions.map((t) => ({
          externalId: null,
          date: t.date,
          amount: t.amount,
          description: t.description
        })),
        bankHint: parsed.bank_hint,
        accountTypeHint: parsed.account_type_hint,
        periodStart: parsed.period_start,
        periodEnd: parsed.period_end,
        dueDate: parsed.due_date
      };
    } else {
      await sb
        .from("statement_imports")
        .update({ status: "failed", parse_errors: { error: "CSV parsing pending" } })
        .eq("id", importRow.id);
      return NextResponse.json({
        importId: importRow.id,
        preview: null,
        message: "CSV em breve. Use OFX ou PDF por enquanto."
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "parse error";
    await sb
      .from("statement_imports")
      .update({ status: "failed", parse_errors: { error: msg } })
      .eq("id", importRow.id);
    return NextResponse.json({ error: `parse failed: ${msg}` }, { status: 400 });
  }

  preview.transactions.sort((a, b) => a.date.localeCompare(b.date));

  await sb
    .from("statement_imports")
    .update({
      status: "parsed",
      parsed_at: new Date().toISOString(),
      transaction_count: preview.count,
      closing_balance: preview.closingBalance,
      due_date: preview.dueDate ?? null
    })
    .eq("id", importRow.id);

  return NextResponse.json({ importId: importRow.id, preview });
}
