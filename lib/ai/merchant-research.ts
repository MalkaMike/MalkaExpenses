import "server-only";
import { vertex, FLASH_MODEL } from "./vertex";
import { CATEGORY_META } from "@/lib/categories/meta";
import type { CnpjData } from "@/lib/cnpj";

// ============================================================================
// "Deep research" for an unrecognized merchant: one Gemini call with Google
// Search grounding enabled (via the existing Vertex AI project — no new
// vendor/account needed) reads the web, ReclameAqui, and any CNPJ registry
// data we found, and produces a full "ficha" (dossier): what the business
// does, official site, segment, reputation, fraud verdict, and a category
// suggestion from the app's own taxonomy.
//
// NOTE: Gemini doesn't allow combining a forced JSON responseSchema with
// tool use (search grounding) in the same call, so the model is instructed to
// answer in a fixed line-labelled text format instead, parsed below.
// ============================================================================

export type MerchantResearchResult = {
  verdict: "legitimo" | "suspeito" | "desconhecido" | "pessoa_fisica";
  whatDoes: string;
  website: string | null;
  segment: string | null;
  reclameAqui: string | null;
  suggestedCategorySlug: string | null;
  summary: string;
  sources: { title: string; url: string }[];
};

function taxonomySlugList(): string {
  return Object.values(CATEGORY_META)
    .map((m) => `${m.slug} (${m.name})`)
    .join(", ");
}

const SYSTEM = `Você investiga um comerciante que apareceu no extrato bancário de um usuário brasileiro e monta uma FICHA completa dele, para o usuário entender o que é esse lançamento.

Use a busca do Google. Procure especificamente por:
- O que a empresa FAZ (produto/serviço) e o site oficial dela
- Reclame Aqui: reputação — existe reclamação de golpe, fraude, cobrança indevida ou assinatura não autorizada?
- Notícias associando esse nome a fraude
- Se foi passado um CNPJ, use os dados de registro (razão social, situação cadastral, atividade) para confirmar a identidade

Responda SEMPRE e SOMENTE neste formato exato, em português simples (sem jargão), uma linha por campo:

VEREDITO: legitimo | suspeito | desconhecido | pessoa_fisica
O_QUE_FAZ: <uma frase curta: o que esse comerciante faz / o que provavelmente foi essa despesa. NUNCA deixe vazio.>
SITE: <url do site oficial, ou "nao encontrado">
SEGMENTO: <rótulo curto do ramo, ex: "streaming de música", "farmácia", "escola", "transferência pessoal">
RECLAME_AQUI: <uma frase sobre a reputação encontrada no Reclame Aqui, ou "nada relevante encontrado">
CATEGORIA_SUGERIDA: <o slug da taxonomia abaixo que melhor descreve essa despesa, ou "manter" se a categoria atual já está certa ou se você não tem confiança>
RESUMO: <um parágrafo explicando o que você encontrou: o que é o comerciante, se parece legítimo, e qualquer sinal de alerta. Se não achou nada conclusivo, diga isso claramente em vez de inventar.>

Taxonomia de categorias do app (use exatamente um destes slugs em CATEGORIA_SUGERIDA):
${taxonomySlugList()}

Regras dos vereditos:
- "pessoa_fisica" = o nome é claramente de uma PESSOA (transferência PIX pessoal, não uma empresa). Use este veredito SEMPRE nesses casos — pessoa não é golpe nem empresa.
- "legitimo" = empresa real e identificável, sem sinais de fraude relevantes.
- "suspeito" = use SOMENTE quando encontrou reclamações/indícios CONCRETOS de golpe, fraude ou cobrança indevida associados a esse nome. Não achar informação NÃO é motivo para "suspeito".
- "desconhecido" = a busca não encontrou informação suficiente para concluir.
- NUNCA invente CNPJ, site, endereço, ou fatos que você não encontrou de fato.`;

type GroundingChunk = { web?: { uri?: string; title?: string } };

const VALID_SLUGS = new Set(Object.keys(CATEGORY_META));

function parseLine(text: string, label: string): string | null {
  const m = text.match(new RegExp(`${label}:\\s*(.+)`, "i"));
  const v = m?.[1]?.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower === "nao encontrado" || lower === "não encontrado" || lower === "n/a" || lower === "-") return null;
  return v;
}

export type KnownProvider = {
  display_name: string;
  full_name: string | null;
  specialty: string;
  clinic: string | null;
};

export async function researchMerchant(
  name: string,
  rawDescriptions: string[],
  cnpjData?: CnpjData | null,
  currentCategoryName?: string | null,
  knownProviders?: KnownProvider[]
): Promise<MerchantResearchResult> {
  const ai = vertex();

  const cnpjLine = cnpjData
    ? `\nDados do CNPJ encontrado no registro oficial: razão social="${cnpjData.razao_social}", situação="${cnpjData.situacao}", atividade="${cnpjData.atividade_principal}".`
    : "";
  const catLine = currentCategoryName
    ? `\nCategoria atual no app: "${currentCategoryName}".`
    : "";
  const providersLine = knownProviders?.length
    ? `\n\nPrestadores de saúde CONHECIDOS da família (se o nome do comerciante corresponder claramente a um destes, é um pagamento legítimo de saúde a esse prestador — diga isso em O_QUE_FAZ, use VEREDITO pessoa_fisica para pessoa ou legitimo para clínica, e CATEGORIA_SUGERIDA saude):
${knownProviders.map((p) => `- "${p.display_name}"${p.full_name ? ` = ${p.full_name}` : ""} — ${p.specialty}${p.clinic ? ` (${p.clinic})` : ""}`).join("\n")}
Só afirme a correspondência quando o nome bater de verdade — não force.`
    : "";

  const prompt = `Nome do comerciante (como aparece no extrato bancário): "${name}"
Descrições brutas associadas a esse lançamento: ${rawDescriptions.slice(0, 5).join(" | ")}${cnpjLine}${catLine}${providersLine}

Monte a ficha desse comerciante no formato pedido.`;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM,
      tools: [{ googleSearch: {} }],
      temperature: 0.1
    }
  });

  const text = response.text ?? "";

  const verdictRaw = text.match(/VEREDITO:\s*(legitimo|suspeito|desconhecido|pessoa_fisica)/i)?.[1]?.toLowerCase();
  const verdict = (verdictRaw as MerchantResearchResult["verdict"] | undefined) ?? "desconhecido";

  const whatDoes = parseLine(text, "O_QUE_FAZ") ?? "Não foi possível identificar o que esse comerciante faz.";
  let website = parseLine(text, "SITE");
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const segment = parseLine(text, "SEGMENTO");
  const reclameAqui = parseLine(text, "RECLAME_AQUI");

  const suggestedRaw = parseLine(text, "CATEGORIA_SUGERIDA")?.toLowerCase().trim();
  const suggestedCategorySlug =
    suggestedRaw && suggestedRaw !== "manter" && VALID_SLUGS.has(suggestedRaw) ? suggestedRaw : null;

  const summaryMatch = text.match(/RESUMO:\s*([\s\S]*)/i);
  const summary = summaryMatch?.[1]?.trim() || text.trim() || "Não foi possível determinar — resposta vazia.";

  const chunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as GroundingChunk[];
  const sources = chunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ title: c.web!.title ?? c.web!.uri!, url: c.web!.uri! }));

  return { verdict, whatDoes, website, segment, reclameAqui, suggestedCategorySlug, summary, sources };
}
