"use client";

import { Quote } from "lucide-react";

// Shared component: render the verbatim policy text behind a rule or term.
// Used in the policy review screen AND the per-claim eligibility panel so the
// "source" is always visible (verifiability principle).
export function SourceQuote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-[10px] text-on-surface-variant/80 italic mt-1.5 flex items-start gap-1">
      <Quote size={9} className="shrink-0 mt-0.5" />
      <span className="line-clamp-3">&ldquo;{text}&rdquo;</span>
    </p>
  );
}
