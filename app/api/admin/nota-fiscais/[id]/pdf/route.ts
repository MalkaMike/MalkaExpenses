import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

// GET /api/admin/nota-fiscais/[id]/pdf
// Serves the PDF file for a given nota fiscal, admin-gated.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();

  const { id } = await params;
  const sb = serverClient();

  const { data: nf } = await sb
    .from("nota_fiscais")
    .select("file_name, provider_name")
    .eq("id", id)
    .maybeSingle();

  if (!nf) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = join(process.cwd(), "private", "nota-fiscais", nf.file_name);

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "PDF file not found on disk" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nf.file_name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
