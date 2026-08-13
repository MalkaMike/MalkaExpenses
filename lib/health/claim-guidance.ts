/**
 * What to ask for on each invoice, and whose job it is.
 *
 * This is a finite, known backlog — 33 invoices whose gaps Mickael and the
 * broker worked through one by one on 2026-08-12. It lives in code rather than
 * behind an editor UI because nobody asked for an editor, and a hand-written
 * note per invoice is the whole content. If it ever needs to be editable, that
 * is a separate change.
 *
 * Keyed by provider, since one report normally covers all of that provider's
 * visits. `byInvoice` overrides where a single nota has its own trap.
 */

export type ClaimOwner = "secretary" | "mickael" | "blocked";

/**
 * One step of the request. A bare string inherits the claim's owner; give a
 * step its own owner when the work is somebody else's — a card stamped "Celina"
 * whose fourth item is Mickael's bank receipt sends her to ask a hospital for
 * something the hospital does not have.
 */
export type Ask = string | { text: string; owner: ClaimOwner };

export type Guidance = {
  owner: ClaimOwner;
  /** Invoices sharing a group are one process — same episode, same request. */
  group?: string;
  groupLabel?: string;
  /** What to request, in the order to ask for it. */
  ask: Ask[];
  /** The thing that gets this claim refused if missed. */
  warning?: string;
};

/** Normalised steps, each with the owner who actually does it. */
export function askSteps(g: Guidance): { text: string; owner: ClaimOwner }[] {
  return g.ask.map((a) => (typeof a === "string" ? { text: a, owner: g.owner } : a));
}

// No priority ranking here, deliberately (Mickael, 2026-08-12): the secretary
// works the whole list rather than a ranked queue. Ordering stays chronological.

export const OWNER_LABEL: Record<ClaimOwner, string> = {
  secretary: "Celina",
  mickael: "Mickael",
  blocked: "Parado — aguarda corretor"
};

const BY_PROVIDER: Record<string, Guidance> = {
  "SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN": {
    owner: "secretary",
    group: "ilay-apendicite",
    groupLabel: "Apendicite do Ilay — internação de 27/05/2026",
    ask: [
      "Relatório hospitalar completo da internação — pedir em einstein.br/atendimento/solicitacao-documentos",
      "Laudo com o diagnóstico (apendicite) dizendo expressamente que foi EMERGÊNCIA e que a cirurgia era inadiável",
      "Atestado Médico Confidencial — no formulário do próprio seguro, levar impresso",
      "A nota do médico que ainda não foi emitida — pedir que emitam",
      { text: "Comprovante do pagamento adiantado de R$ 20.000,00 (extrato do pagamento)", owner: "mickael" },
      {
        text: "Avisar a APRIL por e-mail que foi emergência e não houve autorização prévia — o e-mail cria o registro datado",
        owner: "mickael"
      }
    ],
    warning:
      "A nota mostra R$ 20.000,00 de adiantamento e líquido de R$ 3.134,41. Sem o comprovante do adiantamento, o seguro reembolsa só os R$ 3.134,41."
  },
  "FABIANA IMAGAWA SERVICOS MEDICOS LTDA": {
    owner: "secretary",
    group: "ilay-apendicite",
    groupLabel: "Apendicite do Ilay — internação de 27/05/2026",
    ask: [
      "2ª via da nota fiscal — não temos o PDF",
      "Laudo confirmando a cirurgia de 27/05/2026 e o caráter de urgência"
    ],
    warning: "Esta é a única nota que prova a data da cirurgia. Vai junto com a do Einstein, mesmo processo."
  },
  "MARIANNI CHRISTINA MOREIRA COSTA": {
    owner: "secretary",
    ask: [
      "Um laudo único cobrindo todos os atendimentos, com o DIAGNÓSTICO — por que o Lavi faz fonoaudiologia",
      "Pedir que o laudo separe as datas das sessões"
    ],
    warning:
      "Coberto 100%, sem carência, sem limite de sessões — confirmado na apólice. ATENÇÃO na NF 2355: cobre sessões de 13, 20 e 27 de fevereiro, mas a APRIL só começou em 25/02. Só a sessão do dia 27 entra."
  },
  "D V KATZ SERVIÇOS MEDICOS EIRELI ME": {
    owner: "secretary",
    ask: [
      "Laudo da consulta com o diagnóstico",
      "Correção do nome da paciente na nota"
    ],
    warning:
      "A nota diz \"Mila Hakim Malka\"; na apólice ela é \"Mila Esther Malka\". Nome divergente é motivo clássico de recusa — corrigir antes de enviar."
  },
  "FLEURY S/A": {
    owner: "mickael",
    ask: ["Mickael liga para o Dr. Hélio"],
    warning:
      "Não é da apendicite do Ilay — é exame do próprio Mickael. O que precisa ser obtido é a INDICAÇÃO CLÍNICA registrada: se os exames investigavam algo, paga 100%; se foi check-up de rotina, cai no teto de €/$2.000 e exigia autorização prévia. Falta o PDF da nota."
  },
  "DANIEL HABIB SERVICOS MEDICOS S/S LTDA": {
    owner: "mickael",
    ask: ["Mickael liga para o Dr. Habib"],
    warning:
      "A nota já traz CID 10 J 02 (faringite aguda) — é a mais bem documentada do lote. O Dr. Habib é também quem pode dar a indicação clínica dos exames do Fleury."
  },
  "CEDIPI - CLINICA ESP EM DOENCAS INFEC E PARAS E EM IMUN LTDA": {
    owner: "blocked",
    ask: ["Não acionar a clínica ainda"],
    warning:
      "As notas já trazem o nome e o preço de cada vacina, que é o que a apólice exige — documento não é o problema. O problema é se vacinação de rotina tem cobertura: a apólice só cita vacinas dentro de \"medicamentos ambulatoriais (incluindo vacinas antimaláricas)\". Sem registro de envio nem de recusa no sistema. Perguntar ao corretor antes."
  }
};

/** Per-invoice overrides, by nota_fiscais.nf_number. */
const BY_INVOICE: Record<string, Partial<Guidance>> = {
  "2355": {
    warning:
      "Esta nota cobre as sessões de 13, 20 e 27 de fevereiro de 2026. A APRIL começou em 25/02 — apenas a sessão do dia 27 é reembolsável por ela. As de 13 e 20 são do seguro anterior."
  }
};

/** Providers with no entry get a safe default rather than an empty panel. */
const DEFAULT: Guidance = {
  owner: "secretary",
  ask: ["Laudo médico datado e assinado, com o diagnóstico e a data do atendimento"]
};

export function guidanceFor(providerName: string | null, nfNumber: string | null): Guidance {
  const base = (providerName && BY_PROVIDER[providerName]) || DEFAULT;
  const override = nfNumber ? BY_INVOICE[nfNumber] : undefined;
  return override ? { ...base, ...override } : base;
}

/**
 * The APRIL policy took effect on this date ("Date d'effet: 25/02/2026",
 * Insurance Certificate). Anything treated earlier belongs to the previous
 * insurer (Bradesco) and must not be sent to APRIL — telling them apart on
 * screen is what stops the secretary phoning a 2025 provider "for APRIL".
 */
export const APRIL_START = "2026-02-25";

export type Insurer = "april" | "anterior";

export function insurerFor(emissionDate: string | null): Insurer {
  if (!emissionDate) return "anterior";
  return emissionDate.slice(0, 10) >= APRIL_START ? "april" : "anterior";
}

export const INSURER_LABEL: Record<Insurer, string> = {
  april: "APRIL",
  anterior: "Seguro anterior (Bradesco)"
};
