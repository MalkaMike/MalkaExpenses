import { describe, it, expect } from "vitest";
import { derivePattern, matchesRulePattern } from "@/lib/merchants/rule-pattern";

describe("derivePattern", () => {
  it("takes the first 3 words", () => {
    expect(derivePattern("Pix enviado LAIK MIDIA DIGITAL LTDA")).toBe("Pix enviado LAIK");
  });

  it("returns the whole string when it has fewer than 3 words", () => {
    expect(derivePattern("IFOOD")).toBe("IFOOD");
  });

  it("trims surrounding whitespace and collapses internal runs", () => {
    expect(derivePattern("  Pix   enviado   AKIVA CONSULTORIA  ")).toBe("Pix enviado AKIVA");
  });

  it("returns null when the pattern would be too short to be useful", () => {
    expect(derivePattern("AB")).toBeNull();
    expect(derivePattern("")).toBeNull();
  });
});

describe("matchesRulePattern", () => {
  it("contains (default): matches anywhere in the description", () => {
    const rule = { pattern: "laik midia", pattern_type: "contains" };
    expect(matchesRulePattern(rule, "pix enviado laik midia digital ltda")).toBe(true);
    expect(matchesRulePattern(rule, "pix enviado kenlo")).toBe(false);
  });

  it("starts_with: only matches at the beginning", () => {
    const rule = { pattern: "ifd*", pattern_type: "starts_with" };
    expect(matchesRulePattern(rule, "ifd*organico oscar fre")).toBe(true);
    expect(matchesRulePattern(rule, "pix enviado ifd*organico")).toBe(false);
  });

  it("exact: only matches the whole description", () => {
    const rule = { pattern: "saldo em atraso", pattern_type: "exact" };
    expect(matchesRulePattern(rule, "saldo em atraso")).toBe(true);
    expect(matchesRulePattern(rule, "saldo em atraso mensal")).toBe(false);
  });

  it("is case-insensitive on the pattern side (caller lowercases the description)", () => {
    const rule = { pattern: "AKIVA", pattern_type: "contains" };
    expect(matchesRulePattern(rule, "pix enviado akiva consultoria ltda")).toBe(true);
  });
});
