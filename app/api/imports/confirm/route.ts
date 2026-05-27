import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import { categorizeAll, type CategorizeInput } from "@/lib/ai/categorize";
import { researchMerchants } from "@/lib/ai/merchant-research";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({
  importId: z.string().uuid(),
  accountId: z.string().uuid(),
  transactions: z.array(
    z.object({
      externalId: z.string().nullable(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number(),
      description: z.string(),
      type: z.string().nullable().optional()
    })
  )
});

// Confirm a parsed batch:
//   1. Dedup check (account_id + date + real_amount + description_raw)
//   2. Insert only new rows
//   3. MERCHANT RULES pre-pass: match descriptions against learned rules → apply category directly
//   4. Remaining uncategorized rows → Vertex Gemini Flash (batches of 40)
//   5. Apply category_id + confidence; status=auto_accepted if confidence>=0.85 (or rule match)
//   6. Mark cartao_pagamento/transferencias as is_transfer=true
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { importId, accountId, transactions } = parsed.data;
  const sb = serverClient();

  const { data: imp } = await sb
    .from("statement_imports")
    .select("file_type")
    .eq("id", importId)
    .single();
  const source = (imp?.file_type as "ofx" | "csv" | "pdf") ?? "ofx";

  // Build the full row objects we want to insert
  const rows = transactions.map((t) => ({
    account_id: accountId,
    date: t.date,
    description_raw: t.description,
    description_clean: t.description,
    real_amount: t.amount,
    shared_amount: t.amount,
    source,
    source_file_id: importId,
    status: "pending_review" as const,
    created_by: "import" as const,
    external_id: t.externalId ?? null
  }));

  // ── 1) Dedup check ──────────────────────────────────────────────────────────
  const dates = Array.from(new Set(rows.map((r) => r.date)));

  const { data: alreadyIn } = await sb
    .from("transactions")
    .select("account_id, date, real_amount, description_raw")
    .eq("account_id", accountId)
    .in("date", dates);

  const existingSet = new Set<string>();
  for (const t of alreadyIn ?? []) {
    existingSet.add(
      `${t.account_id}|${t.date}|${Number(t.real_amount)}|${t.description_raw}`
    );
  }

  const newRows = rows.filter(
    (r) =>
      !existingSet.has(
        `${r.account_id}|${r.date}|${Number(r.real_amount)}|${r.description_raw}`
      )
  );
  const duplicateCount = rows.length - newRows.length;

  // ── 2) Insert only genuinely new rows ───────────────────────────────────────
  if (newRows.length > 0) {
    const { error: insErr } = await sb.from("transactions").insert(newRows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // ── 3) Re-fetch inserted rows to get DB-assigned IDs ────────────────────────
  const { data: fetchedRows } = await sb
    .from("transactions")
    .select("id, date, description_raw, real_amount, category_id")
    .eq("account_id", accountId)
    .in("date", dates);

  // Only process rows we just inserted (no category yet)
  const newKeySet = new Set(
    newRows.map((r) => `${r.date}|${Number(r.real_amount)}|${r.description_raw}`)
  );

  const freshRows: Array<{ id: string; date: string; description: string; amount: number }> = [];
  for (const r of fetchedRows ?? []) {
    if (r.category_id) continue; // already categorized
    const key = `${r.date}|${Number(r.real_amount)}|${r.description_raw}`;
    if (!newKeySet.has(key)) continue; // not from this batch
    freshRows.push({
      id: r.id,
      date: r.date,
      description: r.description_raw,
      amount: Number(r.real_amount)
    });
  }

  // ── 4) Merchant rules pre-pass ──────────────────────────────────────────────
  // Fetch all rules ordered by hit_count DESC (most-used rules take priority)
  const { data: rules } = await sb
    .from("merchant_rules")
    .select("pattern, pattern_type, category_id, confidence_default")
    .order("hit_count", { ascending: false });

  // Map tx id → matched category_id + confidence
  const ruleMatched = new Map<string, { category_id: string; confidence: number }>();

  for (const row of freshRows) {
    const desc = row.description.toLowerCase();
    for (const rule of rules ?? []) {
      const pat = rule.pattern.toLowerCase();
      let hit = false;
      if (rule.pattern_type === "exact") {
        hit = desc === pat;
      } else if (rule.pattern_type === "starts_with") {
        hit = desc.startsWith(pat);
      } else {
        // "contains" (default)
        hit = desc.includes(pat);
      }
      if (hit) {
        ruleMatched.set(row.id, {
          category_id: rule.category_id,
          confidence: Number(rule.confidence_default) || 0.95
        });
        break; // first match wins
      }
    }
  }

  // Apply rule-matched categories immediately (no AI needed)
  let ruleAppliedCount = 0;
  for (const [txId, m] of ruleMatched) {
    const isTransfer = false; // merchant rules are for real merchants, not system categories
    await sb
      .from("transactions")
      .update({
        category_id: m.category_id,
        confidence: m.confidence,
        ai_reasoning: "Regra de fornecedor aplicada",
        status: "auto_accepted",
        is_transfer: isTransfer
      })
      .eq("id", txId);
    ruleAppliedCount += 1;
  }

  // Bump hit_count on matched rules (fire-and-forget, non-blocking)
  // We increment per-rule only once per rule, not per transaction
  const usedPatterns = new Set<string>();
  for (const row of freshRows) {
    if (!ruleMatched.has(row.id)) continue;
    const desc = row.description.toLowerCase();
    for (const rule of rules ?? []) {
      const pat = rule.pattern.toLowerCase();
      let hit = false;
      if (rule.pattern_type === "exact") hit = desc === pat;
      else if (rule.pattern_type === "starts_with") hit = desc.startsWith(pat);
      else hit = desc.includes(pat);
      if (hit && !usedPatterns.has(rule.pattern)) {
        usedPatterns.add(rule.pattern);
        sb.from("merchant_rules")
          .update({ hit_count: (rule as { hit_count?: number }).hit_count ?? 1 })
          .eq("pattern", rule.pattern)
          .then(() => {});
      }
    }
  }

  // ── 5) AI categorization for unmatched rows ─────────────────────────────────
  // Three-tier confidence system:
  //   ≥ 0.85  → auto_accepted   (no badge shown)
  //   0.65–0.84 → pending_review  (amber "IA incerta" badge)
  //   < 0.65  → web search via Google grounding → re-evaluate → pending_review
  //             (blue "Pesquisado" if found, red "IA não sabe" if still unknown)

  const aiQueue: CategorizeInput[] = freshRows.filter(
    (r) => !ruleMatched.has(r.id)
  );

  let categorizedCount = 0;
  let researchedCount = 0;
  let aiErr: string | null = null;

  if (aiQueue.length > 0) {
    try {
      const results = await categorizeAll(aiQueue);

      const { data: cats } = await sb.from("categories").select("id, slug");
      const slugToId = new Map<string, string>();
      for (const c of cats ?? []) slugToId.set(c.slug, c.id);

      // Split by confidence tier
      const highConf  = results.filter((r) => r.confidence >= 0.85);
      const midConf   = results.filter((r) => r.confidence >= 0.65 && r.confidence < 0.85);
      const lowConf   = results.filter((r) => r.confidence < 0.65);

      // Tier 1 + 2: apply directly
      for (const r of [...highConf, ...midConf]) {
        const catId = slugToId.get(r.category_slug) ?? slugToId.get("outros");
        if (!catId) continue;
        const isTransfer =
          r.category_slug === "cartao_pagamento" || r.category_slug === "transferencias";
        await sb
          .from("transactions")
          .update({
            category_id: catId,
            confidence: r.confidence,
            ai_reasoning: r.reasoning,
            status: r.confidence >= 0.85 ? "auto_accepted" : "pending_review",
            is_transfer: isTransfer
          })
          .eq("id", r.id);
        categorizedCount += 1;
      }

      // Tier 3: web search for low-confidence items
      if (lowConf.length > 0) {
        const lowItems = lowConf.map((r) => {
          const original = aiQueue.find((q) => q.id === r.id);
          return { id: r.id, description: original?.description ?? r.id, amount: original?.amount ?? 0 };
        });

        try {
          const researched = await researchMerchants(lowItems);
          researchedCount = researched.length;

          for (const r of researched) {
            const catId = slugToId.get(r.category_slug) ?? slugToId.get("outros");
            if (!catId) continue;

            // Even after web search, confidence may still be low → stays pending_review
            const isTransfer =
              r.category_slug === "cartao_pagamento" || r.category_slug === "transferencias";

            // Determine status: if web search gave good confidence, auto-accept
            const status = r.confidence >= 0.80 ? "auto_accepted" : "pending_review";

            await sb
              .from("transactions")
              .update({
                category_id: catId,
                confidence: r.confidence,
                ai_reasoning: r.reasoning, // prefixed with "Pesquisado:" by researchMerchants
                status,
                is_transfer: isTransfer
              })
              .eq("id", r.id);
            categorizedCount += 1;

            // Auto-create merchant_rule if web search confidently identified the merchant
            if (r.confidence >= 0.75) {
              const original = lowItems.find((i) => i.id === r.id);
              if (original) {
                // Use first 3 space-separated tokens as the pattern (avoids overfitting)
                const tokens = original.description.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
                if (tokens.length >= 3) {
                  await sb
                    .from("merchant_rules")
                    .upsert(
                      {
                        pattern: tokens,
                        pattern_type: "starts_with",
                        category_id: catId,
                        confidence_default: r.confidence,
                        hit_count: 1
                      },
                      { onConflict: "pattern" }
                    )
                    .then(() => {}); // fire-and-forget
                }
              }
            }
          }
        } catch (researchErr: unknown) {
          // Web search failure is non-fatal: apply original low-confidence AI result
          console.error("[merchant-research]", researchErr);
          for (const r of lowConf) {
            const catId = slugToId.get(r.category_slug) ?? slugToId.get("outros");
            if (!catId) continue;
            await sb
              .from("transactions")
              .update({
                category_id: catId,
                confidence: r.confidence,
                ai_reasoning: r.confidence < 0.4
                  ? "IA não sabe — comerciante não identificado"
                  : r.reasoning,
                status: "pending_review"
              })
              .eq("id", r.id);
            categorizedCount += 1;
          }
        }
      }
    } catch (e: unknown) {
      aiErr = e instanceof Error ? e.message : "categorization failed";
      console.error("[categorize]", aiErr);
    }
  }

  await sb.from("statement_imports").update({ status: "imported" }).eq("id", importId);

  return NextResponse.json({
    inserted: newRows.length,
    duplicates: duplicateCount,
    ruleMatched: ruleAppliedCount,
    categorized: categorizedCount,
    researched: researchedCount,
    total: rows.length,
    aiError: aiErr
  });
}
