import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { parseOfx } from "@/lib/parsers/ofx";

export const runtime = "nodejs";

// Upload a statement file → store in Supabase Storage, create statement_imports
// row, parse inline if OFX. Returns parse preview to the client.
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
  const fileType = ["ofx", "qfx"].includes(ext) ? "ofx" : ext === "pdf" ? "pdf" : ext === "csv" ? "csv" : null;
  if (!fileType) {
    return NextResponse.json({ error: `unsupported file type: ${ext}` }, { status: 400 });
  }

  const sb = serverClient();

  // Insert statement_imports row
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

  // Upload to Storage (best-effort — schema works even if bucket not configured yet)
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await sb.storage.from("statements").upload(storagePath, buf, {
      contentType: file.type || undefined,
      upsert: false
    });
  } catch {
    // continue — keep parse path working in dev before bucket is created
  }

  // For v0.1 we only parse OFX inline. CSV/PDF return uploaded status.
  if (fileType !== "ofx") {
    return NextResponse.json({
      importId: importRow.id,
      preview: null,
      message: `Uploaded ${file.name}. ${fileType.toUpperCase()} parsing will land in v0.3.`
    });
  }

  let parsed;
  try {
    const text = await file.text();
    parsed = parseOfx(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "parse error";
    await sb
      .from("statement_imports")
      .update({ status: "failed", parse_errors: { error: msg } })
      .eq("id", importRow.id);
    return NextResponse.json({ error: `parse failed: ${msg}` }, { status: 400 });
  }

  await sb
    .from("statement_imports")
    .update({
      status: "parsed",
      parsed_at: new Date().toISOString(),
      transaction_count: parsed.transactions.length
    })
    .eq("id", importRow.id);

  return NextResponse.json({
    importId: importRow.id,
    preview: {
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      currency: parsed.currency,
      count: parsed.transactions.length,
      transactions: parsed.transactions.slice(0, 200) // truncate for client
    }
  });
}
