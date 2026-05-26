import { describe, it, expect } from "vitest";
import { parseOfx } from "./ofx";

const SAMPLE_OFX = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<DTSTART>20250301
<DTEND>20250331
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250305120000
<TRNAMT>-150.00
<FITID>TRN001
<NAME>SUPERMERCADO ZONA SUL
<MEMO>COMPRA CARTAO DEBITO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20250310
<TRNAMT>5000.00
<FITID>TRN002
<NAME>SALARIO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4850.00
<DTASOF>20250331
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

describe("parseOfx", () => {
  it("parses basic SGML OFX with two transactions", () => {
    const r = parseOfx(SAMPLE_OFX);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toMatchObject({
      externalId: "TRN001",
      date: "2025-03-05",
      amount: -150,
      type: "DEBIT"
    });
    expect(r.transactions[1]).toMatchObject({
      externalId: "TRN002",
      date: "2025-03-10",
      amount: 5000
    });
    expect(r.closingBalance).toBe(4850);
    expect(r.currency).toBe("BRL");
  });

  it("uses MEMO over NAME when both present", () => {
    const r = parseOfx(SAMPLE_OFX);
    expect(r.transactions[0].description).toBe("COMPRA CARTAO DEBITO");
  });

  it("falls back to NAME when MEMO absent", () => {
    const r = parseOfx(SAMPLE_OFX);
    expect(r.transactions[1].description).toBe("SALARIO");
  });
});
