import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole, getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { uploadFile } from "@/lib/storage/supabase-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// Documents the secretary collects for one claim — the doctor's report, the
// hospital certificate, proof of payment — parked against the invoice so
// Mickael can send a single email to the insurer with everything attached.
//
// The `claim-attachments` bucket and the upload helper already existed but were
// never wired to anything; this is the first thing to use them.
//
// Storage itself is the record: files live under `<notaFiscalId>/<name>`, so
// listing a claim's documents is a prefix listing. No extra table to drift.
const BUCKET = "claim-attachments";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp"
]);

/** Reject anything that is not a medical invoice, and hide non-medical ones from the secretary. */
async function loadInvoice(id: string) {
  const sb = serverClient();
  const { data, error } = await sb
    .from("nota_fiscais")
    .select("id, is_medical, provider_name")
    .eq("id", id)
    .maybeSingle();
  return { sb, data, error };
}

// Keep the stored name recognisable but safe: no separators, no traversal.
function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "documento";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(-120);
  return cleaned || "documento";
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireAnyHealthRole();
  const { id } = await ctx.params;
  const { sb, data: nf, error } = await loadInvoice(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!nf || !nf.is_medical) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: files, error: listErr } = await sb.storage.from(BUCKET).list(id, {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" }
  });
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  return NextResponse.json({
    attachments: (files ?? [])
      // Supabase returns a placeholder row for empty prefixes.
      .filter((f) => f.name && f.id !== null)
      .map((f) => ({
        name: f.name,
        size: (f.metadata as { size?: number } | null)?.size ?? null,
        uploadedAt: f.created_at ?? null,
        url: `/api/admin/health/queue/${id}/attachments/${encodeURIComponent(f.name)}`
      }))
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireAnyHealthRole();
  const role = await getRole();
  const { id } = await ctx.params;

  const { data: nf, error } = await loadInvoice(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!nf || !nf.is_medical) return NextResponse.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "nenhum arquivo enviado" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "arquivo vazio" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `arquivo muito grande (${(file.size / 1048576).toFixed(1)} MB) — máximo 15 MB` },
      { status: 413 }
    );
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `tipo não aceito (${file.type || "desconhecido"}) — envie PDF ou foto` },
      { status: 415 }
    );
  }

  const name = safeName(file.name);
  const path = `${id}/${name}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    await uploadFile(BUCKET, path, bytes, file.type);
  } catch (e) {
    // uploadFile throws with the bucket/path already in the message.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  await writeAudit("health_claim_attachment", {
    newValue: {
      nota_fiscal_id: id,
      provider: nf.provider_name,
      file: name,
      bytes: file.size,
      by: role
    }
  });

  return NextResponse.json({ ok: true, name, size: file.size });
}
