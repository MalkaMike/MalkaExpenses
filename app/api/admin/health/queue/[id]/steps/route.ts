import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole, getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { guidanceFor, askSteps } from "@/lib/health/claim-guidance";

export const runtime = "nodejs";

// Ticking a request step off, and untucking it again.
//
// The step list lives in code (claim-guidance), so the body only carries the
// index; the text is re-derived here rather than trusted from the client. That
// keeps a stale browser tab from recording a step that no longer exists, and
// means the stored wording is always the wording the server knows.

async function loadClaim(id: string) {
  const sb = serverClient();
  const { data, error } = await sb
    .from("nota_fiscais")
    .select("id, is_medical, provider_name, nf_number")
    .eq("id", id)
    .maybeSingle();
  return { sb, data, error };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireAnyHealthRole();
  const role = await getRole();
  const { id } = await ctx.params;

  const { sb, data: nf, error } = await loadClaim(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!nf || !nf.is_medical) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { index?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  }

  const index = Number(body.index);
  const done = body.done !== false;
  const steps = askSteps(guidanceFor(nf.provider_name, nf.nf_number));

  if (!Number.isInteger(index) || index < 0 || index >= steps.length) {
    return NextResponse.json({ error: "passo inexistente" }, { status: 400 });
  }

  if (done) {
    const { error: upErr } = await sb.from("claim_steps").upsert(
      {
        nota_fiscal_id: id,
        step_index: index,
        step_text: steps[index].text,
        done_by: role ?? "desconhecido",
        done_at: new Date().toISOString()
      },
      { onConflict: "nota_fiscal_id,step_index" }
    );
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  } else {
    const { error: delErr } = await sb
      .from("claim_steps")
      .delete()
      .eq("nota_fiscal_id", id)
      .eq("step_index", index);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await writeAudit("health_claim_step", {
    newValue: { nota_fiscal_id: id, step_index: index, step: steps[index].text, done, by: role }
  });

  return NextResponse.json({ ok: true, index, done });
}
