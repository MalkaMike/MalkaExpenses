import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { extractPolicyFromPdf } from "@/lib/ai/policy";

export const runtime = "nodejs";
export const maxDuration = 120; // policy parsing on Gemini Pro can take a while

// POST /api/admin/health/policies/extract
// Body: { pdf_base64: string, mime_type?: string }
// Returns the AI-extracted (policy + dependents + coverage_rules) for REVIEW.
// Does NOT persist — the user reviews, then POSTs to /api/admin/health/policies.
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: { pdf_base64?: string; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { pdf_base64, mime_type } = body;
  if (!pdf_base64) {
    return NextResponse.json({ error: "pdf_base64 required" }, { status: 400 });
  }

  try {
    const extracted = await extractPolicyFromPdf(
      pdf_base64,
      mime_type ?? "application/pdf"
    );
    return NextResponse.json(extracted);
  } catch (e) {
    return NextResponse.json(
      { error: `extraction failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
