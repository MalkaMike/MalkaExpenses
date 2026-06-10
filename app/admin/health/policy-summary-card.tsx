import Link from "next/link";
import { ShieldCheck, Clock, Send, ChevronRight } from "lucide-react";
import { serverClient } from "@/lib/supabase/server";

// Server component — compact summary of the active health policy, shown at the
// top of the Saúde page so the key facts are always one glance away.
// Full detail (datatable of all rules) lives at /admin/health/policy.
export async function PolicySummaryCard() {
  const sb = serverClient();

  const { data: policies } = await sb
    .from("insurance_policies")
    .select(
      `id, insurer_name, plan_name, plan_tier, cover_zone, currency,
       overall_annual_limit, deductible_text, claim_filing_limit`
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  const policy = policies?.[0];
  if (!policy) return null;

  const { data: waits } = await sb
    .from("policy_terms")
    .select("title, text")
    .eq("policy_id", policy.id)
    .eq("term_type", "waiting_period");

  return (
    <Link
      href="/admin/health/policy"
      className="block mb-5 p-4 rounded-xl border border-outline-variant bg-surface-container-lowest hover:border-primary/30 transition group"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <ShieldCheck size={15} className="text-primary shrink-0" />
          <p className="text-sm font-semibold text-on-surface truncate">
            {policy.insurer_name} · {policy.plan_name ?? ""}
          </p>
          {policy.plan_tier && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">{policy.plan_tier}</span>
          )}
        </div>
        <span className="text-[11px] text-primary inline-flex items-center gap-0.5 shrink-0 group-hover:underline">
          ver apólice <ChevronRight size={12} />
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
        <div>
          <p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Limite anual</p>
          <p className="text-on-surface font-medium">{policy.overall_annual_limit ?? "—"}</p>
        </div>
        <div>
          <p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Franquia</p>
          <p className="text-on-surface font-medium">{policy.deductible_text ?? "—"}</p>
        </div>
        <div>
          <p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Zona / moeda</p>
          <p className="text-on-surface font-medium">Zona {policy.cover_zone ?? "—"} · {policy.currency ?? "—"}</p>
        </div>
        <div>
          <p className="text-on-surface-variant/70 text-[9px] uppercase tracking-wider flex items-center gap-1"><Send size={9} /> Prazo de envio</p>
          <p className="text-on-surface font-medium">2 anos da emissão</p>
        </div>
      </div>

      {(waits ?? []).length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-outline-variant">
          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 flex items-center gap-1 mb-1">
            <Clock size={9} /> Carências
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(waits ?? []).map((w, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant">
                {w.title ?? w.text}{w.title ? `: ${w.text}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </Link>
  );
}
