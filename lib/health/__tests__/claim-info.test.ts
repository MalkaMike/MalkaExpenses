import { describe, it, expect } from "vitest";
import {
  resolvePatient,
  extractCouncilId,
  extractDoctorName,
  canonicaliseName,
  claimGaps,
  type NfLike
} from "../claim-info";

const ROSTER = [
  "Mickael Israel Malka",
  "Ayelet Vardi Malka",
  "Ilay Malka",
  "Lya Malka",
  "Lavi Haim Malka",
  "Mila Esther Malka"
];

function nf(over: Partial<NfLike> = {}): NfLike {
  return {
    patient_name: null,
    recipient_name: null,
    service_description: null,
    provider_name: null,
    provider_cnpj: "12345678000199",
    storage_path: "bucket/x.pdf",
    ...over
  };
}

describe("canonicaliseName", () => {
  it("snaps an OCR-mangled name to the roster", () => {
    // Real data: the invoice said "Mila Hakim Malka" for Mila Esther Malka.
    expect(canonicaliseName("Mila Hakim Malka", ROSTER)).toEqual({
      name: "Mila Esther Malka",
      matched: true
    });
  });

  it("strips trailing text that ran into the name", () => {
    expect(canonicaliseName("MILA ESTHER MALKA. Aplicacoes", ROSTER).name).toBe("Mila Esther Malka");
  });

  it("reports a name that is not on the policy", () => {
    const got = canonicaliseName("Joana Pereira", ROSTER);
    expect(got.matched).toBe(false);
    expect(got.name).toBe("Joana Pereira");
  });

  it("returns empty for junk", () => {
    expect(canonicaliseName("   ", ROSTER)).toEqual({ name: "", matched: false });
  });
});

describe("resolvePatient", () => {
  it("prefers the stored field and marks it confirmed", () => {
    const got = resolvePatient(nf({ patient_name: "Lavi Haim Malka" }), ROSTER);
    expect(got).toEqual({ name: "Lavi Haim Malka", source: "field", confirmed: true });
  });

  it("reads 'Paciente: NOME' out of the description", () => {
    const got = resolvePatient(
      nf({ service_description: "Referente ao servico medico de imunizacao. Paciente: MILA ESTHER MALKA" }),
      ROSTER
    );
    expect(got.name).toBe("Mila Esther Malka");
    expect(got.confirmed).toBe(true);
  });

  it("reads 'cirurgia de NOME' — the phrasing without the word 'paciente'", () => {
    // NF 936, R$ 4.048,10 — missed entirely until this pattern was added.
    const got = resolvePatient(
      nf({ service_description: "Valor referente serviços médicos prestados como 1º auxiliar de cirurgia de Ilay Malka em 27/05/2026." }),
      ROSTER
    );
    expect(got.name).toBe("Ilay Malka");
    expect(got.source).toBe("description");
  });

  it("falls back to the recipient but NEVER marks it confirmed", () => {
    const got = resolvePatient(
      nf({ recipient_name: "MICKAEL ISRAEL MALKA", service_description: "CONSULTA MEDICA CARDIOLOGICA." }),
      ROSTER
    );
    expect(got.name).toBe("Mickael Israel Malka");
    expect(got.source).toBe("recipient");
    expect(got.confirmed).toBe(false);
  });

  it("prefers a child named in the text over the adult recipient", () => {
    // The whole reason recipient is last: the parent pays, the child is treated.
    const got = resolvePatient(
      nf({
        recipient_name: "MICKAEL ISRAEL MALKA",
        service_description: "Nome do paciente: Lavi Haim Malka Especialidade: terapia fonoaudiológica"
      }),
      ROSTER
    );
    expect(got.name).toBe("Lavi Haim Malka");
    expect(got.confirmed).toBe(true);
  });

  it("does not turn a procedure into a patient", () => {
    // Regression, found against live data: "06 sessões de psicoterapia
    // realizadas em dezembro" yielded a confirmed patient named
    // "psicoterapia realizadas" on three invoices totalling R$ 7.500.
    const got = resolvePatient(
      nf({
        service_description:
          "Refere-se a 06 sessões de psicoterapia realizadas em dezembro de 2025, conforme relação abaixo: Solveig Isabel Milharcic - Psicóloga Clínica - CRP 06/50.897"
      }),
      ROSTER
    );
    expect(got.name).toBe("");
    expect(got.source).toBe("unknown");
  });

  it("never confirms a name that is not on the policy", () => {
    const got = resolvePatient(
      nf({ service_description: "Consulta de Fulano Silva em 02/04/2026" }),
      ROSTER
    );
    expect(got.confirmed).toBe(false);
  });

  it("keeps a hand-entered name off the roster, but unconfirmed", () => {
    const got = resolvePatient(nf({ patient_name: "Novo Dependente" }), ROSTER);
    expect(got.name).toBe("Novo Dependente");
    expect(got.source).toBe("field");
    expect(got.confirmed).toBe(false);
  });

  it("gives up honestly when nothing identifies the patient", () => {
    const got = resolvePatient(
      nf({ service_description: "Prestacao de Servico CONSTANTE da FICHA Nr.: 5201237286" }),
      ROSTER
    );
    expect(got).toEqual({ name: "", source: "unknown", confirmed: false });
  });
});

describe("extractCouncilId", () => {
  it.each([
    ["CONSULTA REALIZADA PELO DR DANIEL HABIB CRM 42470 ESPECIALISTA", "CRM", "42470", null],
    ["Consulta Médica com o Dr. Octavio Gonçalves Ribeiro CRM 150.863 - SP", "CRM", "150.863", "SP"],
    ["Referente a consulta oftalmológica Dr. Mauro Goldchmit CRM: 55.792 (PAGO)", "CRM", "55.792", null],
    ["Solveig Isabel Milharcic - Psicóloga Clínica - CRP 06/50.897- CNES 4675665", "CRP", "06/50.897", null]
  ])("pulls the registration from %s", (desc, council, number, uf) => {
    expect(extractCouncilId(desc)).toEqual({ council, number, uf });
  });

  it("returns null when there is no registration", () => {
    expect(extractCouncilId("DESPESAS DE SERVS HOSPITALARES")).toBeNull();
    expect(extractCouncilId(null)).toBeNull();
  });
});

describe("extractDoctorName", () => {
  it("finds the doctor behind a billing company", () => {
    expect(extractDoctorName("Dra. Fabiana Higuchi Imagawa CRM 96.173 Cirurgiã Pediátrica")).toBe(
      "Fabiana Higuchi Imagawa"
    );
  });

  it("stops before the registration number", () => {
    expect(extractDoctorName("Dr. Mauro Goldchmit CRM: 55.792")).toBe("Mauro Goldchmit");
  });

  it("returns null when no doctor is named", () => {
    expect(extractDoctorName("DESPESAS DE SERVS HOSPITALARES E/OU DIAGNOSTICOS")).toBeNull();
  });
});

describe("claimGaps", () => {
  it("is clean when everything is present and confirmed", () => {
    const row = nf({ patient_name: "Ilay Malka" });
    expect(claimGaps(row, resolvePatient(row, ROSTER))).toEqual([]);
  });

  it("flags an unconfirmed patient separately from an unknown one", () => {
    const guessed = nf({ recipient_name: "MICKAEL ISRAEL MALKA" });
    expect(claimGaps(guessed, resolvePatient(guessed, ROSTER))).toContain("patient_unconfirmed");

    const blank = nf();
    expect(claimGaps(blank, resolvePatient(blank, ROSTER))).toContain("patient_unknown");
  });

  it("flags a missing PDF and a missing CNPJ", () => {
    const row = nf({ patient_name: "Ilay Malka", storage_path: null, provider_cnpj: null });
    const gaps = claimGaps(row, resolvePatient(row, ROSTER));
    expect(gaps).toEqual(expect.arrayContaining(["no_pdf", "no_cnpj"]));
  });
});
