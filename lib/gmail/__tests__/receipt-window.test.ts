import { describe, it, expect } from "vitest";
import { installmentInfoFrom } from "../find-receipt-v2";
import { textContainsAmount } from "../value-match";
import { fromDb } from "@/lib/money";

// Descriptions below are copied verbatim from real ledger rows.

describe("installmentInfoFrom", () => {
  it("reads the (N/M) suffix written by pluggy sync", () => {
    expect(installmentInfoFrom("BLANCHE JARDIM COM01/05 (1/5)")).toEqual({ number: 1, total: 5 });
    expect(installmentInfoFrom("BLANCHE JARDIM COM05/05 (5/5)")).toEqual({ number: 5, total: 5 });
  });

  it("reads a trailing NN/MM marker from raw bank text", () => {
    expect(installmentInfoFrom("IZIPIZI 04/04")).toEqual({ number: 4, total: 4 });
  });

  it("returns 1 of 1 when there is no instalment marker", () => {
    for (const d of ["IZIPIZI", "", undefined, null]) {
      expect(installmentInfoFrom(d)).toEqual({ number: 1, total: 1 });
    }
  });

  it("does not mistake a date or a 1-of-1 for an instalment plan", () => {
    expect(installmentInfoFrom("PAGAMENTO 12/05")).toEqual({ number: 1, total: 1 }); // 12 > 5
    expect(installmentInfoFrom("UBER 1/1")).toEqual({ number: 1, total: 1 });        // not a plan
  });
});

describe("amount handed to the receipt search", () => {
  const email = "Blanche Jardim — Total da compra: R$ 107,80. Obrigado!";

  // Regression guard for the cron bug: real_amount is stored in centavos, but
  // the search matches against BRL as written in an email. Passing the raw
  // column made it hunt for "R$ 10.780,00" on a R$ 107,80 purchase.
  it("matches the value as written in an email once converted", () => {
    expect(textContainsAmount(email, fromDb(10780)).found).toBe(true);
  });

  it("would NOT match if the raw centavos column were passed", () => {
    expect(textContainsAmount(email, 10780).found).toBe(false);
  });

  // A 5x receipt quotes the full price, not the monthly slice.
  it("the full price is what a receipt for an instalment plan shows", () => {
    const receipt = "Pedido confirmado — R$ 539,00 em 5x de R$ 107,80";
    const slice = fromDb(10780);
    const { total } = installmentInfoFrom("BLANCHE JARDIM COM03/05 (3/5)");
    expect(textContainsAmount(receipt, Math.round(slice * total * 100) / 100).found).toBe(true);
  });
});
