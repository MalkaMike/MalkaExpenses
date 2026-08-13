import { NextRequest, NextResponse } from "next/server";
import { requireAnyHealthRole, getRole, writeAudit } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { resolveProvider } from "@/lib/health/provider-lookup";

export const runtime = "nodejs";

// Ticking a request step off for a provider, and unticking it.
//
// The step list lives in code (claim-guidance), so the body carries only the
// index and the text is re-derived here. A stale tab therefore cannot record a
// step that no longer exists, and the stored wording is always the server's.
export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  await requireAnyHealthRole();
  const role = await getRole();
  const { key } = await ctx.params;

  const provider = await resolveProvider(key, role);
  if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { index?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  }

  const index = Number(body.index);
  const done = body.done !== false;
  if (!Number.isInteger(index) || index < 0 || index >= provider.steps.length) {
    return NextResponse.json({ error: "passo inexistente" }, { status: 400 });
  }

  const sb = serverClient();

  if (done) {
    const { error } = await sb.from("provider_steps").upsert(
      {
        provider_key: key,
        step_index: index,
        step_text: provider.steps[index].text,
        done_by: role ?? "desconhecido",
        done_at: new Date().toISOString()
      },
      { onConflict: "provider_key,step_index" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await sb
      .from("provider_steps")
      .delete()
      .eq("provider_key", key)
      .eq("step_index", index);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit("health_provider_step", {
    newValue: {
      provider_key: key,
      provider: provider.providerName,
      step_index: index,
      step: provider.steps[index].text,
      done,
      by: role
    }
  });

  return NextResponse.json({ ok: true, index, done });
}
