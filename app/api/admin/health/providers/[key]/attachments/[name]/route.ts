import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole, getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { downloadFile } from "@/lib/storage/supabase-storage";
import { resolveProvider } from "@/lib/health/provider-lookup";

export const runtime = "nodejs";

// Serves one document collected for a provider. Streams the bytes rather than
// handing out a storage URL, so the bucket stays private and every read goes
// through the role check.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string; name: string }> }
) {
  await requireAnyHealthRole();
  const role = await getRole();
  const { key, name } = await ctx.params;

  const decoded = decodeURIComponent(name);
  // The path is built from route params, so refuse anything that could climb
  // out of this provider's folder before it reaches storage.
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!(await resolveProvider(key, role))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await downloadFile("claim-attachments", `${key}/${decoded}`);
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

// Removing a document collected in error. The upload path was one-way: a wrong
// file stayed wrong for ever and still counted towards "documentos guardados",
// which inflates the progress bar with a file nobody can use.
//
// Deleting a claim document destroys evidence, so it is written to the audit
// log with the file name and who did it. The bucket keeps no versions.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string; name: string }> }
) {
  await requireAnyHealthRole();
  const role = await getRole();
  const { key, name } = await ctx.params;

  const decoded = decodeURIComponent(name);
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const provider = await resolveProvider(key, role);
  if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sb = serverClient();
  const { error: rmErr } = await sb.storage.from("claim-attachments").remove([`${key}/${decoded}`]);
  if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 500 });

  await writeAudit("health_provider_attachment_deleted", {
    oldValue: { provider_key: key, provider: provider.providerName, file: decoded, by: role }
  });

  return NextResponse.json({ ok: true });
}
