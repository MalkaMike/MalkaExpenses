import "server-only";
import { Type } from "@google/genai";
import { vertex, PRO_MODEL } from "./vertex";

// ============================================================================
// Document scanner — Gemini 2.5 Pro reads a photographed/scanned document
// (nota fiscal OR doctor's prescription) and extracts structured data:
// what it is, the provider/doctor, the price, the quantity/items, the date.
//
// Used by the mobile scan flow and manual upload. Gemini reads images and PDFs
// natively (handwritten prescriptions included), so no separate OCR step.
// ============================================================================

export type ScannedItem = {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

export type ScanResult = {
  doc_kind: "nota_fiscal" | "prescription" | "other";
  confidence: string; // high | medium | low
  // when doc_kind = nota_fiscal
  nota_fiscal: {
    provider_name: string | null;
    provider_cnpj: string | null;
    emission_date: string | null; // YYYY-MM-DD
    total_amount: number | null;
    patient_name: string | null;
    is_medical: boolean;
    service_description: string | null;
    items: ScannedItem[];
  } | null;
  // when doc_kind = prescription
  prescription: {
    doctor_name: string | null;
    doctor_crm: string | null;
    patient_name: string | null;
    issue_date: string | null; // YYYY-MM-DD
    description: string | null; // what was prescribed / requested
    items: ScannedItem[];
  } | null;
  raw_text: string | null; // full text read off the document
};

const SYSTEM = `Você lê documentos brasileiros fotografados ou escaneados e extrai dados estruturados.

Classifique o documento (doc_kind):
- "nota_fiscal": nota fiscal / NFS-e / recibo / cupom (tem valor pago, prestador, CNPJ)
- "prescription": pedido médico / receita / prescrição / solicitação de exame (tem médico, CRM)
- "other": qualquer outra coisa

Para nota_fiscal extraia: prestador (provider_name), CNPJ, data de emissão (YYYY-MM-DD),
valor total (total_amount), paciente se mencionado, se é um serviço MÉDICO/saúde (is_medical:
médico, clínica, hospital, laboratório, exame, dentista, psicólogo, fisioterapia, etc.),
descrição do serviço, e os ITENS com quantidade e preço (a "quantidade/volume" importa).

Para prescription extraia: nome do médico, CRM, paciente, data (YYYY-MM-DD), o que foi
prescrito/solicitado (description) e os itens.

REGRAS:
- Se um valor não estiver legível/presente, use null. NUNCA invente preços, CNPJ ou CRM.
- raw_text: transcreva o texto que você conseguiu ler do documento.
- Valores em BRL como número (ex: 1234.56). Datas sempre YYYY-MM-DD.
- Retorne JSON estrito conforme o schema.`;

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    quantity: { type: Type.NUMBER, nullable: true },
    unit_price: { type: Type.NUMBER, nullable: true },
    amount: { type: Type.NUMBER, nullable: true },
  },
  required: ["description"],
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    doc_kind: { type: Type.STRING },
    confidence: { type: Type.STRING },
    nota_fiscal: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        provider_name: { type: Type.STRING, nullable: true },
        provider_cnpj: { type: Type.STRING, nullable: true },
        emission_date: { type: Type.STRING, nullable: true },
        total_amount: { type: Type.NUMBER, nullable: true },
        patient_name: { type: Type.STRING, nullable: true },
        is_medical: { type: Type.BOOLEAN },
        service_description: { type: Type.STRING, nullable: true },
        items: { type: Type.ARRAY, items: ITEM_SCHEMA },
      },
      required: ["is_medical"],
    },
    prescription: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        doctor_name: { type: Type.STRING, nullable: true },
        doctor_crm: { type: Type.STRING, nullable: true },
        patient_name: { type: Type.STRING, nullable: true },
        issue_date: { type: Type.STRING, nullable: true },
        description: { type: Type.STRING, nullable: true },
        items: { type: Type.ARRAY, items: ITEM_SCHEMA },
      },
    },
    raw_text: { type: Type.STRING, nullable: true },
  },
  required: ["doc_kind", "confidence"],
};

// Read a scanned/photographed document (image or PDF, base64) and extract it.
export async function scanDocument(
  base64: string,
  mimeType: string
): Promise<ScanResult> {
  const ai = vertex();
  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: "Leia este documento e extraia os dados estruturados." },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
    },
  });
  return JSON.parse(response.text ?? "{}") as ScanResult;
}
