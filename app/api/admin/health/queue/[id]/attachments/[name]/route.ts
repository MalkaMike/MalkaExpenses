import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { downloadFile } from "@/lib/storage/supabase-storage";

export const runtime = "nodejs";

// Serves one document collected for a claim. Streams the bytes rather than
// handing out a storage URL, so the bucket stays private and every read goes
// through the role check.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; name: string }> }
) {
  await requireAnyHealthRole();
  const { id, name } = await ctx.params;

  const decoded = decodeURIComponent(name);
  // The path is built from route params, so refuse anything that could climb
  // out of this invoice's folder before it reaches storage.
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sb = serverClient();
  const { data: nf, error } = await sb
    .from("nota_fiscais")
    .select("id, is_medical")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!nf || !nf.is_medical) return NextResponse.json({ error: "not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await downloadFile("claim-attachments", `${id}/${decoded}`);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const lower = decoded.toLowerCase();
  const type = lower.endsWith(".pdf")
    ? "application/pdf"
    : lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".heic")
          ? "image/heic"
          : "image/jpeg";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${decoded.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
