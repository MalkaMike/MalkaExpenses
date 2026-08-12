import { describe, it, expect } from "vitest";
import {
  guidanceFor,
  insurerFor,
  APRIL_START,
  OWNER_LABEL
} from "../claim-guidance";

describe("insurerFor", () => {
  it("splits on the APRIL effective date", () => {
    expect(insurerFor("2026-02-25")).toBe("april");
    expect(insurerFor("2026-02-24")).toBe("anterior");
    expect(APRIL_START).toBe("2026-02-25");
  });

  it("handles a full timestamp, not just a date", () => {
    expect(insurerFor("2026-06-02T09:45:49+00:00")).toBe("april");
    expect(insurerFor("2025-06-08T10:00:00+00:00")).toBe("anterior");
  });

  it("treats a missing date as the older insurer rather than guessing APRIL", () => {
    // Sending a pre-policy invoice to APRIL wastes a claim; the safe default
    // is the one that makes someone check.
    expect(insurerFor(null)).toBe("anterior");
  });
});

describe("guidanceFor", () => {
  it("groups the two appendicitis invoices into one process", () => {
    const einstein = guidanceFor("SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN", "16883309");
    const surgeon = guidanceFor("FABIANA IMAGAWA SERVICOS MEDICOS LTDA", "936");
    expect(einstein.group).toBe("ilay-apendicite");
    expect(surgeon.group).toBe("ilay-apendicite");
    expect(einstein.priority).toBe(1);
  });

  it("puts the R$20.000 advance in the Einstein warning", () => {
    const g = guidanceFor("SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN", "16883309");
    expect(g.warning).toContain("20.000");
    expect(g.ask.join(" ")).toMatch(/EMERG/);
  });

  it("assigns Fleury and Habib to Mickael, not the secretary", () => {
    expect(guidanceFor("FLEURY S/A", "302313").owner).toBe("mickael");
    expect(guidanceFor("DANIEL HABIB SERVICOS MEDICOS S/S LTDA", "5991").owner).toBe("mickael");
  });

  it("marks the vaccines blocked so the clinic is not called yet", () => {
    const g = guidanceFor("CEDIPI - CLINICA ESP EM DOENCAS INFEC E PARAS E EM IMUN LTDA", "471098");
    expect(g.owner).toBe("blocked");
    expect(OWNER_LABEL[g.owner]).toMatch(/corretor/i);
  });

  it("overrides the speech-therapy warning on the invoice that straddles the policy start", () => {
    const straddling = guidanceFor("MARIANNI CHRISTINA MOREIRA COSTA", "2355");
    const normal = guidanceFor("MARIANNI CHRISTINA MOREIRA COSTA", "2372");
    expect(straddling.warning).toContain("13, 20 e 27 de fevereiro");
    expect(normal.warning).not.toBe(straddling.warning);
    // The override must not wipe the rest of the provider's guidance.
    expect(straddling.ask).toEqual(normal.ask);
    expect(straddling.owner).toBe("secretary");
  });

  it("falls back to a usable instruction for an unknown provider", () => {
    const g = guidanceFor("CLINICA NOVA QUE NUNCA VIMOS", "999");
    expect(g.owner).toBe("secretary");
    expect(g.ask.length).toBeGreaterThan(0);
  });

  it("survives a null provider", () => {
    expect(guidanceFor(null, null).ask.length).toBeGreaterThan(0);
  });
});
