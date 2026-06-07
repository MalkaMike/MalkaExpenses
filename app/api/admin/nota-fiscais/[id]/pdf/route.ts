import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { downloadFile, type StorageBucket } from "@/lib/storage/supabase-storage";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

// GET /api/admin/nota-fiscais/[id]/pdf
// Serves the PDF for a nota fiscal. Reads from Supabase Storage when the row
// has been migrated (storage_bucket + storage_path set); falls back to local
// private/ disk for rows not yet migrated.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();

  const { id } = await params;
  const sb = serverClient();

  const { data: nf } = await sb
    .from("nota_fiscais")
    .select("file_name, provider_name, storage_bucket, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!nf) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let buffer: Buffer;

  if (nf.storage_bucket && nf.storage_path) {
    try {
      buffer = await downloadFile(nf.storage_bucket as StorageBucket, nf.storage_path);
    } catch (e) {
      return NextResponse.json({ error: `Storage error: ${(e as Error).message}` }, { status: 502 });
    }
  } else {
    // Local disk fallback — dev environment or pre-migration
    const filePath = join(process.cwd(), "private", "nota-fiscais", nf.file_name);
    try {
      buffer = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: "PDF not found on disk or in storage" }, { status: 404 });
    }
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nf.file_name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
