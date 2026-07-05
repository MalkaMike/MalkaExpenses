import "server-only";

// ============================================================================
// CNPJ (Brazilian company registry) lookup via BrasilAPI — free, public, no
// key required. Used opportunistically when a bank transaction's raw
// description happens to contain a CNPJ, to ground the deep-research feature
// with official registry data (razão social, situação cadastral, atividade).
// ============================================================================

export type CnpjData = {
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  data_abertura: string | null;
  atividade_principal: string | null;
};

const CNPJ_RE = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/;

/** Finds the first CNPJ-shaped number in a list of raw strings, digits only. */
export function extractCnpj(texts: string[]): string | null {
  for (const t of texts) {
    const m = t.match(CNPJ_RE);
    if (m) return m[1].replace(/\D/g, "");
  }
  return null;
}

/** Looks up a CNPJ in BrasilAPI. Returns null on any failure (not found, rate-limited, network). */
export async function lookupCnpj(cnpj: string): Promise<CnpjData | null> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return {
      razao_social: (j.razao_social as string) ?? null,
      nome_fantasia: (j.nome_fantasia as string) ?? null,
      situacao: (j.descricao_situacao_cadastral as string) ?? null,
      data_abertura: (j.data_inicio_atividade as string) ?? null,
      atividade_principal: (j.cnae_fiscal_descricao as string) ?? null
    };
  } catch {
    return null;
  }
}
