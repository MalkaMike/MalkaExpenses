import "server-only";
import { Type } from "@google/genai";
import { vertex, FLASH_MODEL } from "./vertex";

// ============================================================================
// PDF bank-statement parser via Gemini 2.5 Flash multimodal.
// Handles Itaú, Bradesco, Nubank CC, Inter, BTG — any BR layout.
// Returns normalized transactions + optional closing balance + due date.
// ============================================================================

export type ParsedPdfTransaction = {
  date: string; // YYYY-MM-DD
  amount: number; // signed: negative=expense, positive=credit
  description: string;
};

export type ParsedPdf = {
  bank_hint: string | null;
  account_type_hint: "checking" | "savings" | "credit_card" | null;
  period_start: string | null; // YYYY-MM-DD
  period_end: string | null;
  closing_balance: number | null;
  due_date: string | null; // for CC statements
  currency: string;
  transactions: ParsedPdfTransaction[];
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    bank_hint: { type: Type.STRING, nullable: true },
    account_type_hint: { type: Type.STRING, nullable: true },
    period_start: { type: Type.STRING, nullable: true },
    period_end: { type: Type.STRING, nullable: true },
    closing_balance: { type: Type.NUMBER, nullable: true },
    due_date: { type: Type.STRING, nullable: true },
    currency: { type: Type.STRING },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          description: { type: Type.STRING }
        },
        required: ["date", "amount", "description"]
      }
    }
  },
  required: ["currency", "transactions"]
};

const SYSTEM = `Você extrai TODAS as transações de um extrato bancário ou de cartão de crédito brasileiro.

Regras críticas:
- Datas no formato ISO YYYY-MM-DD. Se só houver dd/mm sem ano, use o ano do período do extrato.
- Valores em reais (BRL). Use ponto como separador decimal. NEGATIVO para débitos / despesas / compras no cartão. POSITIVO para créditos / receitas / pagamentos recebidos.
- Para extrato de cartão de crédito: cada compra é negativa; pagamento da fatura é positivo (reduz o saldo devedor).
- Para extrato bancário: PIX/TED recebido é positivo; PIX/TED enviado é negativo; tarifas e débitos automáticos são negativos.
- Capture TODAS as transações da página, não pule nenhuma. Inclua tarifas, IOF, anuidade.
- description: usar exatamente como aparece no extrato, sem traduzir.
- bank_hint: itau, bradesco, santander, nubank, inter, btg, c6, outro
- account_type_hint: "checking" | "savings" | "credit_card"
- closing_balance: o saldo final do período (para banco) ou valor total da fatura (para cartão)
- due_date: data de vencimento (apenas para cartão de crédito)

Se a página estiver vazia ou ilegível, retorne transactions: [].`;

export async function parsePdfStatement(
  pdfBytes: Uint8Array,
  mimeType: string = "application/pdf"
): Promise<ParsedPdf> {
  const ai = vertex();

  // Convert bytes to base64 for inlineData
  const base64 = Buffer.from(pdfBytes).toString("base64");

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text: "Extraia todas as transações deste extrato no schema fornecido."
          }
        ]
      }
    ],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0
    }
  });

  const text = response.text ?? "{}";
  let parsed: Partial<ParsedPdf> & { transactions?: ParsedPdfTransaction[] };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse Gemini response: ${(e as Error).message}`);
  }

  return {
    bank_hint: parsed.bank_hint ?? null,
    account_type_hint:
      (parsed.account_type_hint as ParsedPdf["account_type_hint"]) ?? null,
    period_start: parsed.period_start ?? null,
    period_end: parsed.period_end ?? null,
    closing_balance: parsed.closing_balance ?? null,
    due_date: parsed.due_date ?? null,
    currency: parsed.currency ?? "BRL",
    transactions: (parsed.transactions ?? []).filter(
      (t) =>
        t.date &&
        typeof t.amount === "number" &&
        t.description !== undefined
    )
  };
}
