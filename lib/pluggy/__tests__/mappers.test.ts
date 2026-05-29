import { describe, it, expect } from "vitest";
import {
  signedAmount,
  mapAccountType,
  mapBankKey,
  type PluggyTransaction
} from "../mappers";

function tx(partial: Partial<PluggyTransaction>): PluggyTransaction {
  return {
    id: "t1",
    accountId: "a1",
    amount: 0,
    date: "2026-05-01",
    description: "x",
    ...partial
  };
}

describe("signedAmount", () => {
  it("DEBIT is always negative (expense)", () => {
    expect(signedAmount(tx({ amount: 100, type: "DEBIT" }))).toBe(-100);
    expect(signedAmount(tx({ amount: -100, type: "DEBIT" }))).toBe(-100);
  });
  it("CREDIT is always positive (income)", () => {
    expect(signedAmount(tx({ amount: 100, type: "CREDIT" }))).toBe(100);
    expect(signedAmount(tx({ amount: -100, type: "CREDIT" }))).toBe(100);
  });
  it("with no type, trusts Pluggy's already-signed amount", () => {
    expect(signedAmount(tx({ amount: -42.5, type: null }))).toBe(-42.5);
    expect(signedAmount(tx({ amount: 42.5 }))).toBe(42.5);
  });
});

describe("mapAccountType", () => {
  it("CREDIT → credit_card", () => {
    expect(mapAccountType("CREDIT")).toBe("credit_card");
  });
  it("BANK → checking by default", () => {
    expect(mapAccountType("BANK")).toBe("checking");
  });
  it("BANK with savings subtype → savings", () => {
    expect(mapAccountType("BANK", "SAVINGS_ACCOUNT")).toBe("savings");
    expect(mapAccountType("BANK", "savings")).toBe("savings");
  });
  it("unknown type → checking", () => {
    expect(mapAccountType("WHATEVER")).toBe("checking");
  });
});

describe("mapBankKey", () => {
  it("maps known Brazilian connectors", () => {
    expect(mapBankKey("Itaú")).toBe("itau");
    expect(mapBankKey("Itau Personnalité")).toBe("itau");
    expect(mapBankKey("Nubank")).toBe("nubank");
    expect(mapBankKey("Bradesco")).toBe("bradesco");
    expect(mapBankKey("Banco Inter")).toBe("inter");
    expect(mapBankKey("BTG Pactual")).toBe("btg");
    expect(mapBankKey("C6 Bank")).toBe("c6");
  });
  it("falls back to 'outro' for unknown / empty", () => {
    expect(mapBankKey("Some Random Bank")).toBe("outro");
    expect(mapBankKey("")).toBe("outro");
  });
});
