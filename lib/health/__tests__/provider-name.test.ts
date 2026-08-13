import { describe, it, expect } from "vitest";
import { displayProvider } from "../provider-name";

describe("displayProvider", () => {
  it("calms a shouted company name", () => {
    expect(displayProvider("SOCIEDADE BENEF ISRAELITABRAS HOSPITAL ALBERT EINSTEIN")).toBe(
      "Sociedade Benef Israelitabras Hospital Albert Einstein"
    );
    expect(displayProvider("FABIANA IMAGAWA SERVICOS MEDICOS LTDA")).toBe(
      "Fabiana Imagawa Servicos Medicos LTDA"
    );
  });

  it("keeps legal forms and initialisms uppercase", () => {
    expect(displayProvider("MILHARCIC E BAROSSI CLINICA PSICOLOGICA S/S")).toBe(
      "Milharcic e Barossi Clinica Psicologica S/S"
    );
    expect(displayProvider("R3 CLINICA MEDICA E PSIQUIATRICA SS")).toBe(
      "R3 Clinica Medica e Psiquiatrica SS"
    );
    expect(displayProvider("EPCORDIS ASSISTENCIA MEDICA S/S LTDA")).toBe(
      "Epcordis Assistencia Medica S/S LTDA"
    );
  });

  it("leaves single-letter initials alone", () => {
    expect(displayProvider("D V KATZ SERVIÇOS MEDICOS EIRELI ME")).toBe(
      "D V Katz Serviços Medicos EIRELI ME"
    );
  });

  it("lowercases connectives only when they are not the first word", () => {
    expect(displayProvider("DE PAULA CLINICA")).toBe("De Paula Clinica");
    expect(displayProvider("CLINICA DE PAULA")).toBe("Clinica de Paula");
  });

  it("handles accents and hyphens", () => {
    expect(displayProvider("ÓTICA SÃO-PAULO")).toBe("Ótica São-Paulo");
  });

  it("never returns an empty label", () => {
    expect(displayProvider(null)).toBe("—");
    expect(displayProvider("")).toBe("—");
  });
});
