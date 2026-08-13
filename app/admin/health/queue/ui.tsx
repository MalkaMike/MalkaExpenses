"use client";

import { AlertTriangle } from "lucide-react";
import { formatDate } from "@/lib/format";

/**
 * The few shared pieces of the reimbursement screens, so the list and the
 * provider page cannot drift apart. Apple language: one filled colour, one
 * outlined colour, everything interactive is a capsule, nothing has a shadow.
 */

export const PILL_FILLED =
  "inline-flex items-center justify-center gap-1.5 rounded-ap-pill bg-apple-blue px-4 py-2.5 " +
  "text-ap-body-sm font-normal text-white transition hover:opacity-90 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

export const PILL_OUTLINED =
  "inline-flex items-center justify-center gap-1.5 rounded-ap-pill border border-link-blue px-4 py-2.5 " +
  "text-ap-body-sm font-normal text-link-blue transition hover:bg-link-blue/5 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2";

export const CARD = "rounded-ap-card border border-hairline bg-white";
export const CHIP = "rounded-ap-pill px-2 py-0.5 text-ap-caption whitespace-nowrap";

export function fmt(d: string | null | undefined) {
  return d ? formatDate(d.slice(0, 10)) : "—";
}

/** Digits only, with the country code, for a wa.me link. */
export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ap-caption font-semibold uppercase tracking-wide text-ash">{children}</p>
  );
}

/** Attention without colour-screaming: hairline box, carbon text, one icon. */
export function Notice({
  tone = "warn",
  children
}: {
  tone?: "warn" | "error";
  children: React.ReactNode;
}) {
  return (
    <div className={`${CARD} flex gap-2 p-3`}>
      <AlertTriangle
        size={14}
        className={`mt-0.5 shrink-0 ${tone === "error" ? "text-error" : "text-carbon"}`}
      />
      <div className="text-ap-body-sm text-carbon">{children}</div>
    </div>
  );
}

/** A thin progress bar. Nothing to read here that the caption does not say. */
export function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-ap-pill bg-pebble">
      <div className="h-full rounded-ap-pill bg-apple-blue transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
