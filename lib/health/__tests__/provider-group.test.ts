import { describe, it, expect } from "vitest";
import { groupByProvider, providerKey, type GroupableClaim } from "../provider-group";
import type { Guidance } from "../claim-guidance";

// Everything here is synthetic, and the CNPJ-shaped values are BUILT rather
// than written out: the family's real numbers and names must not live in
// committed source (LGPD; the repo's pii-scan hook enforces it).
const digits = (d: string) => d.repeat(14).slice(0, 14);
const KEY_A = digits("1");
const KEY_B = digits("2");
const KEY_C = digits("3");
/** Same key, written the way an invoice formats it. */
const FORMATTED_A = `${KEY_A.slice(0, 2)}.${KEY_A.slice(2, 5)}.${KEY_A.slice(5, 8)}/${KEY_A.slice(8, 12)}-${KEY_A.slice(12)}`;

const GUIDANCE: Guidance = { owner: "secretary", ask: ["pedir o laudo", "pedir o recibo"] };

function claim(p: Partial<GroupableClaim> & { id: string }): GroupableClaim {
  return {
    nfNumber: "1",
    emissionDate: "2026-03-01",
    providerName: "CLINICA EXEMPLO LTDA",
    cnpj: FORMATTED_A,
    patient: "Paciente Um",
    patientConfirmed: true,
    amount: 850,
    hasPdf: true,
    state: "not_submitted",
    gaps: [],
    guidance: GUIDANCE,
    steps: [
      { text: "pedir o laudo", owner: "secretary" },
      { text: "pedir o recibo", owner: "secretary" }
    ],
    insurer: "april",
    deadline: "2028-03-01",
    ...p
  };
}

describe("providerKey", () => {
  it("uses the digits, whatever the punctuation", () => {
    expect(providerKey(FORMATTED_A, "qualquer")).toBe(KEY_A);
    expect(providerKey(KEY_A, "qualquer")).toBe(KEY_A);
  });

  it("falls back to a slug when the invoice has no CNPJ", () => {
    expect(providerKey(null, "Clínica São João")).toBe("clinica-sao-joao");
    expect(providerKey("", "FALCAO BAUER E TORTAMANO")).toBe("falcao-bauer-e-tortamano");
  });

  it("never returns an empty key", () => {
    expect(providerKey(null, null)).toBe("sem-nome");
    expect(providerKey(null, "!!!")).toBe("sem-nome");
  });

  it("does not treat a malformed number as a CNPJ", () => {
    expect(providerKey("123", "Clinica X")).toBe("clinica-x");
  });
});

describe("groupByProvider", () => {
  it("collapses six invoices of one provider into one card", () => {
    const claims = [1, 2, 3, 4, 5, 6].map((n) => claim({ id: `c${n}` }));
    const groups = groupByProvider(claims);
    expect(groups).toHaveLength(1);
    expect(groups[0].claims).toHaveLength(6);
    expect(groups[0].total).toBe(5100);
  });

  it("splits the invoices by insurer inside the group", () => {
    const groups = groupByProvider([
      claim({ id: "a", insurer: "april", amount: 100 }),
      claim({ id: "b", insurer: "anterior", amount: 200 }),
      claim({ id: "c", insurer: "anterior", amount: 300 })
    ]);
    expect(groups[0].april.map((c) => c.id)).toEqual(["a"]);
    expect(groups[0].previous.map((c) => c.id)).toEqual(["b", "c"]);
    expect(groups[0].aprilTotal).toBe(100);
    expect(groups[0].previousTotal).toBe(500);
  });

  it("takes the EARLIEST deadline — that is the one that binds", () => {
    const groups = groupByProvider([
      claim({ id: "a", deadline: "2028-06-02" }),
      claim({ id: "b", deadline: "2027-01-15" })
    ]);
    expect(groups[0].deadline).toBe("2027-01-15");
  });

  it("lists each patient once", () => {
    const groups = groupByProvider([
      claim({ id: "a", patient: "Paciente Um" }),
      claim({ id: "b", patient: "Paciente Um" }),
      claim({ id: "c", patient: "Paciente Dois" })
    ]);
    expect(groups[0].patients).toEqual(["Paciente Um", "Paciente Dois"]);
  });

  it("is only done with every step ticked AND a document", () => {
    const claims = [claim({ id: "a" })];

    const noDocs = groupByProvider(claims, new Map([[KEY_A, [0, 1]]]), new Map([[KEY_A, 0]]));
    expect(noDocs[0].done).toBe(false);

    const noSteps = groupByProvider(claims, new Map([[KEY_A, [0]]]), new Map([[KEY_A, 2]]));
    expect(noSteps[0].done).toBe(false);

    const both = groupByProvider(claims, new Map([[KEY_A, [0, 1]]]), new Map([[KEY_A, 1]]));
    expect(both[0].done).toBe(true);
  });

  it("counts steps per owner, so her progress is not diluted by Mickael's", () => {
    const claims = [
      claim({
        id: "a",
        steps: [
          { text: "ligar", owner: "secretary" },
          { text: "pagar", owner: "mickael" },
          { text: "e-mail", owner: "mickael" }
        ]
      })
    ];
    const g = groupByProvider(claims, new Map([[KEY_A, [0]]]))[0];
    expect(g.stepsForOwner("secretary")).toEqual({ done: 1, total: 1 });
    expect(g.stepsForOwner("mickael")).toEqual({ done: 0, total: 2 });
  });

  it("puts the most work left first, and sinks the finished ones", () => {
    const groups = groupByProvider(
      [
        claim({ id: "a", cnpj: KEY_A, providerName: "A", amount: 100 }),
        claim({ id: "b", cnpj: KEY_B, providerName: "B", amount: 5000 }),
        claim({ id: "c", cnpj: KEY_C, providerName: "C", amount: 900 })
      ],
      // B is finished; C has one step left; A has two.
      new Map([
        [KEY_B, [0, 1]],
        [KEY_C, [0]]
      ]),
      new Map([[KEY_B, 1]])
    );
    expect(groups.map((g) => g.providerName)).toEqual(["A", "C", "B"]);
  });

  it("breaks a tie on money, biggest first", () => {
    const groups = groupByProvider([
      claim({ id: "a", cnpj: KEY_A, providerName: "pequeno", amount: 100 }),
      claim({ id: "b", cnpj: KEY_B, providerName: "grande", amount: 9000 })
    ]);
    expect(groups.map((g) => g.providerName)).toEqual(["grande", "pequeno"]);
  });

  it("reports an unreadable document count as unknown, never as zero", () => {
    const groups = groupByProvider([claim({ id: "a" })], new Map(), null);
    expect(groups[0].attachmentCount).toBe(null);
    expect(groups[0].done).toBe(false);
  });
});
