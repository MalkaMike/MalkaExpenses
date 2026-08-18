/**
 * The secretary works by PROVIDER, not by invoice.
 *
 * 33 medical invoices come from 12 providers: D V Katz alone has 6, CEDIPI 8.
 * One phone call gets one report covering all of that provider's visits — which
 * is why the guidance was always keyed by provider. The screen was keyed by
 * invoice anyway, so she opened six near-identical cards to make one call.
 *
 * This groups them. Pure, so the ordering and the "is it done" rule can be
 * tested without a browser or a database.
 */

import type { ClaimState } from "./claim-status";
import type { ClaimGap } from "./claim-info";
import type { ClaimOwner, Guidance, Insurer } from "./claim-guidance";

/** The shape this module needs from a claim; the API row carries more. */
export type GroupableClaim = {
  id: string;
  nfNumber: string | null;
  emissionDate: string | null;
  providerName: string | null;
  cnpj: string | null;
  patient: string | null;
  patientConfirmed: boolean;
  amount: number | null;
  hasPdf: boolean;
  state: ClaimState;
  gaps: ClaimGap[];
  guidance: Guidance;
  steps: { text: string; owner: ClaimOwner }[];
  insurer: Insurer;
  deadline: string | null;
};

export type ProviderGroup<T extends GroupableClaim = GroupableClaim> = {
  /** Stable id for the URL and for storing steps and documents. */
  key: string;
  providerName: string;
  cnpj: string | null;
  /** Same for every invoice of the provider — that is the whole point. */
  guidance: Guidance;
  steps: { text: string; owner: ClaimOwner }[];
  stepsDone: number[];
  claims: T[];
  /** Split because one call is one call, but the paperwork goes to two places. */
  april: T[];
  previous: T[];
  total: number;
  aprilTotal: number;
  previousTotal: number;
  patients: string[];
  /** Earliest filing limit across the invoices — the one that actually binds. */
  deadline: string | null;
  blocking: ClaimGap[];
  attachmentCount: number | null;
  /** Steps that are hers, out of the total. Mickael's are counted separately. */
  stepsForOwner: (owner: ClaimOwner) => { done: number; total: number };
  /** Every step ticked AND at least one document collected. */
  done: boolean;
};

/** Digits-only CNPJ when there is one; otherwise a slug of the name. */
export function providerKey(cnpj: string | null, providerName: string | null): string {
  const digits = (cnpj ?? "").replace(/\D/g, "");
  if (digits.length === 14) return digits;
  return (
    (providerName ?? "sem-nome")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "sem-nome"
  );
}

const BLOCKING: ClaimGap[] = ["patient_unknown", "no_pdf"];

export function groupByProvider<T extends GroupableClaim>(
  claims: T[],
  stepsDoneByKey: Map<string, number[]> = new Map(),
  attachmentsByKey: Map<string, number> | null = new Map()
): ProviderGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const c of claims) {
    const key = providerKey(c.cnpj, c.providerName);
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }

  const groups: ProviderGroup<T>[] = [];

  for (const [key, list] of byKey) {
    // Newest first inside a provider: she reads the recent visits out loud.
    const sorted = [...list].sort((a, b) =>
      (b.emissionDate ?? "").localeCompare(a.emissionDate ?? "")
    );
    const head = sorted[0];
    // A group only exists because a claim was pushed into it, so `head` is
    // always present in practice. It is read defensively anyway: this function
    // renders the secretary's whole screen, and reading `.steps` off undefined
    // throws during render, which React answers with a blank page and no way
    // out. Skipping one malformed group loses one row; throwing loses the job.
    if (!head || !head.steps || !head.guidance) continue;
    const april = sorted.filter((c) => c.insurer === "april");
    const previous = sorted.filter((c) => c.insurer === "anterior");
    const sum = (l: T[]) => l.reduce((s, c) => s + (c.amount ?? 0), 0);
    const steps = head.steps;
    const stepsDone = stepsDoneByKey.get(key) ?? [];
    const attachmentCount = attachmentsByKey ? attachmentsByKey.get(key) ?? 0 : null;

    const deadlines = sorted.map((c) => c.deadline).filter((d): d is string => Boolean(d));
    const blocking = [...new Set(sorted.flatMap((c) => c.gaps))].filter((g) =>
      BLOCKING.includes(g)
    );

    groups.push({
      key,
      providerName: head.providerName ?? "—",
      cnpj: head.cnpj,
      guidance: head.guidance,
      steps,
      stepsDone,
      claims: sorted,
      april,
      previous,
      total: sum(sorted),
      aprilTotal: sum(april),
      previousTotal: sum(previous),
      patients: [...new Set(sorted.map((c) => c.patient).filter((p): p is string => Boolean(p)))],
      // The earliest limit is the one that binds the whole request.
      deadline: deadlines.length ? deadlines.sort()[0] : null,
      blocking,
      attachmentCount,
      stepsForOwner: (owner) => {
        const idx = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.owner === owner);
        return {
          done: idx.filter(({ i }) => stepsDone.includes(i)).length,
          total: idx.length
        };
      },
      // "Done" is derived, never a button: every step ticked and at least one
      // document collected. A provider with all its steps ticked and nothing
      // stored has produced no evidence, which is not done.
      done: steps.length > 0 && stepsDone.length >= steps.length && (attachmentCount ?? 0) > 0
    });
  }

  return groups.sort(compareGroups);
}

/**
 * Most work left first, so the top row is literally the next phone call.
 * Finished providers sink. Ties break on money, biggest first.
 */
export function compareGroups(a: ProviderGroup, b: ProviderGroup): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const left = (g: ProviderGroup) => g.steps.length - g.stepsDone.length;
  const diff = left(b) - left(a);
  if (diff !== 0) return diff;
  return b.total - a.total;
}
