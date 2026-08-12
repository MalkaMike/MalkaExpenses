import "server-only";
import type { serverClient } from "@/lib/supabase/server";

type SB = ReturnType<typeof serverClient>;

/**
 * How many days without a single new bank transaction before we call the
 * ingestion dead. Bank data normally lands within a day, so 3 gives a weekend
 * of slack without letting a real outage hide.
 */
export const STALE_AFTER_DAYS = 3;

export type IngestFreshness = {
  /** When the newest Pluggy-sourced row was written, or null if there are none. */
  lastIngestAt: string | null;
  /** Whole days since that write. null when there has never been an ingest. */
  daysStale: number | null;
  isStale: boolean;
  /** Set when the check itself failed — the answer is unknown, not "fresh". */
  error?: string;
};

/**
 * Is the bank ingestion actually alive?
 *
 * Answers with `created_at` — when the row was WRITTEN — not `date`, which is
 * when the purchase happened. That distinction is the whole point: on
 * 2026-08-12 this app held 143 transactions dated in the previous 35 days and
 * had ingested nothing for 10 weeks. They were future-dated credit-card
 * installments from a single June import, so every `date`-based check read as
 * healthy while the pipe was dead.
 *
 * A failed check reports `isStale: true` with an `error`. Treating "I couldn't
 * tell" as "everything is fine" is exactly how the outage stayed invisible.
 */
export async function checkIngestFreshness(
  sb: SB,
  maxAgeDays: number = STALE_AFTER_DAYS
): Promise<IngestFreshness> {
  const { data, error } = await sb
    .from("transactions")
    .select("created_at")
    .eq("source", "pluggy")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { lastIngestAt: null, daysStale: null, isStale: true, error: error.message };
  }
  if (!data?.created_at) {
    return { lastIngestAt: null, daysStale: null, isStale: true };
  }

  const last = new Date(data.created_at as string);
  const daysStale = Math.floor((Date.now() - last.getTime()) / 86_400_000);
  return {
    lastIngestAt: data.created_at as string,
    daysStale,
    isStale: daysStale >= maxAgeDays
  };
}

/** Human-readable alert body. Kept here so the cron route stays about control flow. */
export function freshnessAlertHtml(f: IngestFreshness, syncErrors: string[]): string {
  const when = f.lastIngestAt
    ? `${new Date(f.lastIngestAt).toLocaleString("pt-BR")} (${f.daysStale} dias atrás)`
    : "nunca";
  const errs = syncErrors.length
    ? `<p><b>Erros do sync nesta rodada:</b></p><ul>${syncErrors
        .map((e) => `<li>${e.replace(/[<>&]/g, "")}</li>`)
        .join("")}</ul>`
    : "<p>O sync não reportou nenhum erro — ele está rodando e voltando vazio.</p>";
  const checkFailed = f.error
    ? `<p><b>A própria verificação falhou:</b> ${f.error.replace(/[<>&]/g, "")}</p>`
    : "";

  return `
    <p><b>Nenhuma transação nova entrou no Casa.</b></p>
    <p>Última transação recebida do banco: <b>${when}</b>.</p>
    ${checkFailed}
    ${errs}
    <p>O que verificar, nesta ordem: (1) o plano do Pluggy permite atualizar contas
    reais? (2) as conexões bancárias precisam de nova autorização? (3) o cron
    <code>/api/cron/pluggy-sync</code> está rodando na Vercel?</p>
    <p style="color:#666">Este aviso existe porque, em agosto de 2026, o app passou
    10 semanas sem receber dados enquanto se reportava saudável.</p>
  `;
}
