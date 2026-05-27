import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { serverClient } from "@/lib/supabase/server";
import { ReviewClient, type ReviewRow } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const sb = serverClient();

  const { data: rows } = await sb
    .from("transactions")
    .select(
      "id, account_id, date, description_raw, description_clean, real_amount, shared_amount, confidence, ai_reasoning, status, is_fake, is_transfer, categories(slug)"
    )
    .or("status.eq.pending_review,confidence.lt.0.9")
    .order("confidence", { ascending: true, nullsFirst: true })
    .order("date", { ascending: false })
    .limit(500);

  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name")
    .eq("is_archived", false);

  const accountMap = new Map<string, string>();
  for (const a of accounts ?? []) accountMap.set(a.id, a.name);

  const out: ReviewRow[] = (rows ?? []).map((r: {
    id: string;
    account_id: string;
    date: string;
    description_raw: string;
    description_clean: string | null;
    real_amount: number;
    shared_amount: number;
    confidence: number | null;
    ai_reasoning: string | null;
    status: string;
    is_fake: boolean;
    is_transfer: boolean;
    categories: { slug: string } | { slug: string }[] | null;
  }) => ({
    id: r.id,
    accountName: accountMap.get(r.account_id) ?? "—",
    date: r.date,
    description: r.description_clean ?? r.description_raw,
    descriptionRaw: r.description_raw,
    amountReal: Number(r.real_amount),
    amountShared: Number(r.shared_amount),
    confidence: r.confidence !== null ? Number(r.confidence) : null,
    reasoning: r.ai_reasoning,
    status: r.status,
    isFake: r.is_fake,
    isTransfer: r.is_transfer,
    categorySlug: Array.isArray(r.categories)
      ? r.categories[0]?.slug ?? "outros"
      : r.categories?.slug ?? "outros"
  }));

  return (
    <div className="px-4 pt-6 max-w-2xl mx-auto pb-24">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted hover:text-fg gap-1"
        >
          <ChevronLeft size={14} /> admin
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Revisão</h1>
        <p className="text-xs text-muted">
          {out.length === 0
            ? "Tudo revisado — nada pendente."
            : `${out.length} ${out.length === 1 ? "movimento precisa" : "movimentos precisam"} de verificação`}
        </p>
      </header>

      <ReviewClient rows={out} />
    </div>
  );
}
