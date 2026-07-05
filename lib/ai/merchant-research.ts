import "server-only";
import { vertex, FLASH_MODEL } from "./vertex";
import type { CnpjData } from "@/lib/cnpj";

// ============================================================================
// "Deep research" for an unrecognized merchant: one Gemini call with Google
// Search grounding enabled (via the existing Vertex AI project — no new
// vendor/account needed) reads the web, ReclameAqui, and any CNPJ registry
// data we found, and writes one plain-language verdict.
//
// NOTE: Gemini doesn't allow combining a forced JSON responseSchema with
// tool use (search grounding) in the same call, so the model is instructed to
// answer in a fixed VEREDITO/RESUMO text format instead, parsed below.
// ============================================================================

export type MerchantResearchResult = {
  verdict: "legitimo" | "suspeito" | "desconhecido";
  summary: string;
  sources: { title: string; url: string }[];
};

const SYSTEM = `Você investiga um comerciante desconhecido que apareceu no extrato bancário de um usuário brasileiro, para ajudá-lo a entender o que é esse lançamento.

Use a busca do Google para responder com o máximo de precisão possível. Procure especificamente por:
- Reclame Aqui: existe reclamação de golpe, fraude, cobrança indevida ou assinatura não autorizada?
- Site oficial da empresa — o que ela vende/faz
- Notícias associando esse nome a fraude
- Se foi passado um CNPJ, use os dados de registro (razão social, situação cadastral) para confirmar a identidade

Responda SEMPRE e SOMENTE neste formato exato, em português simples (sem jargão):

VEREDITO: legitimo | suspeito | desconhecido
RESUMO: <um parágrafo curto explicando o que é esse comerciante, se parece uma empresa legítima e identificável, e qualquer sinal de alerta de fraude encontrado. Se a busca não achar nada conclusivo, diga isso claramente em vez de inventar.>

Regras:
- "legitimo" = empresa real e identificável, sem sinais de fraude relevantes.
- "suspeito" = reclamações de golpe/fraude/cobrança indevida associadas a esse nome.
- "desconhecido" = a busca não encontrou informação suficiente para concluir.
- NUNCA invente CNPJ, endereço, ou fatos que você não encontrou de fato.`;

type GroundingChunk = { web?: { uri?: string; title?: string } };

export async function researchMerchant(
  name: string,
  rawDescriptions: string[],
  cnpjData?: CnpjData | null
): Promise<MerchantResearchResult> {
  const ai = vertex();

  const cnpjLine = cnpjData
    ? `\nDados do CNPJ encontrado no registro oficial: razão social="${cnpjData.razao_social}", situação="${cnpjData.situacao}", atividade="${cnpjData.atividade_principal}".`
    : "";

  const prompt = `Nome do comerciante (como aparece no extrato bancário): "${name}"
Descrições brutas associadas a esse lançamento: ${rawDescriptions.slice(0, 5).join(" | ")}${cnpjLine}

Investigue esse comerciante e responda no formato pedido.`;

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
  const verdictMatch = text.match(/VEREDITO:\s*(legitimo|suspeito|desconhecido)/i);
  const summaryMatch = text.match(/RESUMO:\s*([\s\S]*)/i);

  const verdict = (verdictMatch?.[1]?.toLowerCase() as MerchantResearchResult["verdict"] | undefined) ?? "desconhecido";
  const summary = summaryMatch?.[1]?.trim() || text.trim() || "Não foi possível determinar — resposta vazia.";

  const chunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as GroundingChunk[];
  const sources = chunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ title: c.web!.title ?? c.web!.uri!, url: c.web!.uri! }));

  return { verdict, summary, sources };
}
