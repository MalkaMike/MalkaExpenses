import "server-only";
import type { serverClient } from "@/lib/supabase/server";
import {
  getItem,
  listAccounts,
  listTransactions,
  enrichTransactions,
  signedAmount,
  mapAccountType,
  mapBankKey,
  type PluggyTransaction,
  type PluggyEnrichedTransaction
} from "@/lib/pluggy/client";
import { categorizeAll, type CategorizeInput } from "@/lib/ai/categorize";
import { isCcPaymentDescription, isInvestmentSweepDescription } from "@/lib/reconciliation/cc-matcher";
import { mapPluggyCategory } from "@/lib/pluggy/mappers";
import { toDb, fromDb } from "@/lib/money";
import { matchesRulePattern } from "@/lib/merchants/rule-pattern";
import { pairReissued, supersededForecasts } from "@/lib/pluggy/reissued";

type SB = ReturnType<typeof serverClient>;

export type PluggySyncResult = {
  accounts: number;
  inserted: number;
  relinked: number; // same bank row under a new Pluggy id — updated, not re-inserted
  redated: number; // same id, Pluggy moved the date (instalment re-dated)
  categorized: number;
  reconciled: number;
  perAccount: Array<{ accountName: string; inserted: number }>;
  // Non-fatal failures collected along the way. Empty = clean sync. The old
  // version swallowed insert/update errors entirely — a failed batch insert
  // reported `inserted: 0` with ok:true and the bank data was silently lost.
  errors: string[];
};

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

// Reimbursement tags that also hide a transaction from the shared household
// ledger — mirrors hideOnTag in app/api/admin/merchants/[key]/tag/route.ts.
const HIDE_ON_TAG_SLUGS = new Set(["kenlo", "laik"]);

// How far back to pull on the first sync of an account.
function defaultFromDate(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
}

// Incremental window with overlap: re-pull before the last sync so
// late-posting transactions (dated before our last run but posted after) aren't
// missed. 7 days was too short: Bradesco rows of 10–14/07 arrived later and were
// never pulled. The id dedup plus pairReissued() make the overlap duplicate-free.
function incrementalFromDate(lastSyncIso: string, overlapDays = 45): string {
  const d = new Date(`${isoToDate(lastSyncIso)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return defaultFromDate();
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Sync one Pluggy item (one bank login → one or more accounts) into Casa.
 *  - links each Pluggy account to a Casa account (creating it on first sync)
 *  - pulls transactions since the account's last sync (12 months on first run)
 *  - dedups on the Pluggy transaction id (transactions.external_id)
 *  - fills the REAL ledger (real_amount = shared_amount = signed amount); the
 *    admin still curates shared_amount, so the dual ledger is unaffected
 *  - categorizes new rows with the existing AI pipeline, then runs CC reconcile
 */
export async function syncPluggyItem(sb: SB, itemId: string): Promise<PluggySyncResult> {
  const item = await getItem(itemId);
  const bankKey = mapBankKey(item.connector?.name ?? "");
  const pluggyAccounts = await listAccounts(itemId);

  const result: PluggySyncResult = {
    accounts: 0,
    inserted: 0,
    relinked: 0,
    redated: 0,
    categorized: 0,
    reconciled: 0,
    perAccount: [],
    errors: []
  };

  for (const pa of pluggyAccounts) {
    // 1) Find or create the Casa account for this Pluggy account.
    const { data: existing } = await sb
      .from("accounts")
      .select("id, pluggy_last_sync, is_archived")
      .eq("pluggy_account_id", pa.id)
      .maybeSingle();

    // Skip archived accounts — they were retired deliberately (e.g. duplicate Pluggy item).
    if (existing?.is_archived) continue;

    let accountId: string;
    let isNew = false;
    const lastSync: string | null = existing?.pluggy_last_sync ?? null;

    if (existing) {
      accountId = existing.id as string;
    } else {
      const { data: created, error: createErr } = await sb
        .from("accounts")
        .insert({
          name: pa.name || item.connector?.name || "Conta",
          bank: bankKey,
          type: mapAccountType(pa.type, pa.subtype),
          real_starting_balance: 0,
          shared_starting_balance: 0,
          cc_issuer: pa.type === "CREDIT" ? bankKey : null,
          pluggy_item_id: itemId,
          pluggy_account_id: pa.id
        })
        .select("id")
        .single();
      if (createErr || !created) {
        // never throw mid-loop, but make the failure visible
        result.errors.push(`account create failed (${pa.name || bankKey}): ${createErr?.message ?? "no row"}`);
        continue;
      }
      accountId = created.id as string;
      isNew = true;
    }
    result.accounts += 1;

    // 2) Pull transactions since last sync (overlap by a few days to catch
    //    late-posting items; dedup handles the overlap).
    const from = lastSync ? incrementalFromDate(lastSync) : defaultFromDate();
    let pluggyTx: PluggyTransaction[] = [];
    try {
      pluggyTx = await listTransactions(pa.id, from);
    } catch (e) {
      // One account failing shouldn't abort the whole item.
      result.errors.push(`listTransactions failed (${pa.name || bankKey}): ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // Drop stale PENDING instalment forecasts whose POSTED row already exists:
    // an app row still holding a forecast id then re-links to the posted one.
    const forecasts = supersededForecasts(pluggyTx);
    pluggyTx = pluggyTx.filter((t) => !forecasts.has(t.id));

    // 3) Dedup against already-imported pluggy ids for this account.
    //    Scoped to the pull window AND paginated: the old unscoped read was
    //    silently truncated at PostgREST's 1000-row cap (this account family
    //    already has up to 2,473 pluggy rows), so `seen` missed old ids,
    //    re-inserts collided with ux_tx_pluggy and the WHOLE batch — new
    //    rows included — was dropped on every sync.
    const seen = new Set<string>();
    const held: Array<{ id: string; external_id: string; date: string; description_raw: string; real_amount: number }> = [];
    let dedupFailed = false;
    {
      const PAGE = 1000;
      for (let fromIdx = 0; ; fromIdx += PAGE) {
        const { data: page, error: pageErr } = await sb
          .from("transactions")
          .select("id, external_id, date, description_raw, real_amount")
          .eq("account_id", accountId)
          .eq("source", "pluggy")
          .gte("date", from)
          .order("id")
          .range(fromIdx, fromIdx + PAGE - 1);
        if (pageErr) {
          result.errors.push(`dedup read failed (${pa.name || bankKey}): ${pageErr.message}`);
          dedupFailed = true;
          break;
        }
        for (const r of page ?? []) {
          seen.add(r.external_id as string);
          held.push(r as (typeof held)[number]);
        }
        if (!page || page.length < PAGE) break;
      }
    }
    if (dedupFailed) continue; // can't dedup safely → skip this account this run

    // Build rows keyed by pluggy id so we can apply enrichment before insert.
    const newTxById = new Map(
      pluggyTx.filter((t) => !seen.has(t.id)).map((t) => [t.id, t])
    );
    const builtRows = Array.from(newTxById.values()).map((t) => {
      const amt = signedAmount(t);
      const desc = t.description || t.descriptionRaw || "—";
      // Append installment label when Pluggy provides the metadata.
      const cc = t.creditCardMetadata;
      const installmentSuffix =
        cc?.installmentNumber && cc?.totalInstallments
          ? ` (${cc.installmentNumber}/${cc.totalInstallments})`
          : "";
      // Business accounts (Kenlo/Laik/Akiva) stay out of the shared household
      // ledger — always hidden from Ayelet regardless of category.
      const isBusinessAccount = /kenlo|laik|akiva/i.test(desc);
      return {
        account_id: accountId,
        date: isoToDate(t.date),
        description_raw: desc,
        description_clean: desc + installmentSuffix,
        real_amount: toDb(amt),
        shared_amount: isBusinessAccount ? 0 : toDb(amt),
        source: "pluggy" as const,
        status: "auto_accepted" as const,
        created_by: "import" as const,
        external_id: t.id
      };
    });

    // 3b) Re-issued ids: an incoming row that is the same bank row as one we
    //     already hold under an id Pluggy no longer returns gets RE-LINKED
    //     (new id/date/text on the old row, which keeps its hand review)
    //     instead of inserted a second time. Nothing is ever deleted here.
    const liveById = new Map(pluggyTx.map((t) => [t.id, t]));
    const orphans = held.filter((r) => !liveById.has(r.external_id));

    // Same id, new date: Pluggy re-dates instalments when a bill closes
    // (NICOM 07/08 kept 20/09 here while Pluggy says 14/08) — follow it so the
    // row lands in the right month.
    for (const r of held) {
      const t = liveById.get(r.external_id);
      if (!t || isoToDate(t.date) === r.date) continue;
      const { error: dErr } = await sb.from("transactions").update({ date: isoToDate(t.date) }).eq("id", r.id);
      if (dErr) result.errors.push(`redate failed (${pa.name || bankKey}): ${dErr.message}`);
      else result.redated += 1;
    }
    const relinked = new Set<string>();
    for (const { orphan, row } of pairReissued(builtRows, orphans)) {
      const { error: relErr } = await sb
        .from("transactions")
        .update({ external_id: row.external_id, date: row.date, description_raw: row.description_raw })
        .eq("id", orphan.id);
      if (relErr) result.errors.push(`relink failed (${pa.name || bankKey}): ${relErr.message}`);
      else relinked.add(row.external_id);
    }
    result.relinked += relinked.size;
    for (const id of relinked) newTxById.delete(id);
    const newRows = builtRows.filter((r) => !relinked.has(r.external_id));

    // Pluggy's own category per transaction id — used as a categorization prior.
    const pluggyCatById = new Map<string, string | null>();
    for (const t of pluggyTx) pluggyCatById.set(t.id, t.category ?? null);

    // Enrich new transactions: get clean merchant name + better category from
    // Pluggy's enrichment model. Non-fatal — falls back to the standard pipeline.
    const enrichById = new Map<string, PluggyEnrichedTransaction>();
    if (newTxById.size > 0) {
      try {
        const accountType = pa.type === "CREDIT" ? "CREDIT_CARD" : "CHECKING";
        const enriched = await enrichTransactions(
          Array.from(newTxById.values()).map((t) => ({
            id: t.id,
            amount: signedAmount(t),
            date: t.date,
            description: t.description || t.descriptionRaw || ""
          })),
          { accountType }
        );
        for (const e of enriched) enrichById.set(e.id, e);
      } catch {
        // enrichment failure is non-fatal — rows still get categorized via merchant rules / AI
      }
    }

    // Apply enriched merchant name to description_clean when available.
    const newRowsEnriched = newRows.map((row) => {
      const enriched = enrichById.get(row.external_id);
      const merchantName = enriched?.merchant?.name ?? enriched?.merchant?.businessName ?? null;
      return merchantName ? { ...row, description_clean: merchantName } : row;
    });

    let insertedIds: Array<{
      id: string;
      date: string;
      description: string;
      amount: number;
      pluggyCategory: string | null;
      enrichedCategory: string | null;
    }> = [];
    if (newRowsEnriched.length > 0) {
      const mapIns = (r: { id: string; date: string; description_raw: string; real_amount: number; external_id: string }) => ({
        id: r.id,
        date: r.date,
        description: r.description_raw,
        amount: fromDb(Number(r.real_amount)),
        pluggyCategory: pluggyCatById.get(r.external_id) ?? null,
        enrichedCategory: enrichById.get(r.external_id)?.category ?? null
      });
      const { data: ins, error: insErr } = await sb
        .from("transactions")
        .insert(newRowsEnriched)
        .select("id, date, description_raw, real_amount, external_id");
      if (!insErr && ins) {
        insertedIds = ins.map(mapIns);
      } else if (insErr?.code === "23505") {
        // Unique violation: some row in the batch already exists (ux_tx_pluggy).
        // A multi-row INSERT is all-or-nothing, so retry row-by-row and skip
        // only the true duplicates — the old code dropped the whole batch here.
        for (const row of newRowsEnriched) {
          const { data: one, error: oneErr } = await sb
            .from("transactions")
            .insert(row)
            .select("id, date, description_raw, real_amount, external_id")
            .single();
          if (!oneErr && one) insertedIds.push(mapIns(one));
          else if (oneErr && oneErr.code !== "23505") {
            result.errors.push(`row insert failed (${pa.name || bankKey}): ${oneErr.message}`);
          }
        }
      } else if (insErr) {
        result.errors.push(`batch insert failed (${pa.name || bankKey}, ${newRowsEnriched.length} rows): ${insErr.message}`);
      }
    }
    result.inserted += insertedIds.length;
    result.perAccount.push({ accountName: pa.name || bankKey, inserted: insertedIds.length });

    // 4) First-sync balance calibration: set the REAL starting balance so the
    //    admin's computed real balance matches Pluggy's reported balance. The
    //    SHARED starting balance stays 0 — the household sees only accepted
    //    entries, so its balance must not leak the real total.
    if (isNew) {
      const sumImported = insertedIds.reduce((s, r) => s + r.amount, 0);
      const starting = pa.balance - sumImported;
      const { error: calErr } = await sb
        .from("accounts")
        .update({ real_starting_balance: toDb(starting), shared_starting_balance: 0 })
        .eq("id", accountId);
      // A silent failure here permanently miscalibrates the account's real balance.
      if (calErr) result.errors.push(`starting-balance calibration failed (${pa.name || bankKey}): ${calErr.message}`);
    }

    // 5) Categorize the new rows with the existing AI pipeline (enriched category
    //    → Pluggy category → merchant rules → Gemini batch). Skipped if nothing new.
    if (insertedIds.length > 0) {
      try {
        result.categorized += await categorizeFresh(sb, insertedIds, result.errors);
      } catch (e) {
        // categorization failure is non-fatal — rows stay pending_review.
        result.errors.push(`categorize failed (${pa.name || bankKey}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const { error: stampErr } = await sb
      .from("accounts")
      .update({ pluggy_last_sync: new Date().toISOString() })
      .eq("id", accountId);
    if (stampErr) result.errors.push(`last-sync stamp failed (${pa.name || bankKey}): ${stampErr.message}`);
  }

  // Note: CC reconciliation is NOT run here — synced rows stay in the admin
  // acceptance inbox until reviewed. Reconcile is a separate admin action.
  return result;
}

// Categorize freshly-synced rows: CC-payment → enriched category → Pluggy's own
// category → merchant rules → Gemini batch (only the leftovers reach the LLM).
//
// Updates are BUCKETED by identical patch payload and applied with one
// `.update().in("id", ids)` per bucket. The old version issued one UPDATE per
// row — a 200-row sync meant ~200 sequential round-trips inside the same
// serverless time budget as the Gemini calls.
async function categorizeFresh(
  sb: SB,
  rows: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    pluggyCategory: string | null;
    enrichedCategory: string | null;
  }>,
  errors: string[]
): Promise<number> {
  // Merchant rules + slug map + reimbursement tags in parallel (independent reads).
  const [rulesRes, catsRes, tagsRes] = await Promise.all([
    sb
      .from("merchant_rules")
      .select("pattern, pattern_type, category_id, reimbursement_tag_id, confidence_default")
      .order("hit_count", { ascending: false }),
    sb.from("categories").select("id, slug"),
    sb.from("reimbursement_tags").select("id, slug")
  ]);
  if (rulesRes.error) errors.push(`merchant_rules read failed: ${rulesRes.error.message}`);
  if (catsRes.error) errors.push(`categories read failed: ${catsRes.error.message}`);
  if (tagsRes.error) errors.push(`reimbursement_tags read failed: ${tagsRes.error.message}`);
  const rules = rulesRes.data;
  const slugToId = new Map<string, string>();
  for (const c of catsRes.data ?? []) slugToId.set(c.slug as string, c.id as string);
  const ccPayId = slugToId.get("cartao_pagamento");
  const transferId = slugToId.get("transferencias");
  const tagIdToSlug = new Map<string, string>();
  for (const t of tagsRes.data ?? []) tagIdToSlug.set(t.id as string, t.slug as string);
  const tagRules = (rules ?? []).filter((r) => r.reimbursement_tag_id);
  const categoryRules = (rules ?? []).filter((r) => r.category_id);
  // Collected independently of the category cascade below — a row can match
  // a tag-only rule (no category_id) and still need AI/Pluggy to categorize it.
  const tagsToApply: Array<{ transactionId: string; tagId: string }> = [];
  const hiddenIds = new Set<string>();

  // patch-payload buckets: identical patch → single UPDATE ... WHERE id IN (...)
  type Patch = Record<string, string | number | boolean>;
  const buckets = new Map<string, { patch: Patch; ids: string[] }>();
  function bucketAdd(patch: Patch, id: string) {
    const key = JSON.stringify(patch);
    const b = buckets.get(key);
    if (b) b.ids.push(id);
    else buckets.set(key, { patch, ids: [id] });
  }

  const remaining: typeof rows = [];
  for (const row of rows) {
    // Reimbursement-tag rule — independent of the category cascade below, so
    // a tag-only rule (Kenlo/Laik/Plano) never skips real categorization.
    const descLower = row.description.toLowerCase();
    const tagHit = tagRules.find((r) => matchesRulePattern(r, descLower));
    if (tagHit?.reimbursement_tag_id) {
      tagsToApply.push({ transactionId: row.id, tagId: tagHit.reimbursement_tag_id });
      const slug = tagIdToSlug.get(tagHit.reimbursement_tag_id);
      if (slug && HIDE_ON_TAG_SLUGS.has(slug)) hiddenIds.add(row.id);
    }

    // 0) Credit-card BILL PAYMENT → it's a transfer, not a real expense
    //    (the card purchases already arrive on the card account). Mark it so it
    //    doesn't double-count. Deterministic — runs before merchant rules / AI.
    if (ccPayId && isCcPaymentDescription(row.description)) {
      bucketAdd(
        {
          category_id: ccPayId,
          is_transfer: true,
          shared_amount: 0,
          confidence: 0.99,
          ai_reasoning: "Pagamento de cartão — marcado como transferência",
          status: "auto_accepted"
        },
        row.id
      );
      continue;
    }

    // 0.1) Automatic investment sweep (own account ↔ own fund) → transfer.
    if (transferId && isInvestmentSweepDescription(row.description)) {
      bucketAdd(
        {
          category_id: transferId,
          is_transfer: true,
          shared_amount: 0,
          confidence: 0.99,
          ai_reasoning: "Aplicação/resgate automático — marcado como transferência",
          status: "auto_accepted"
        },
        row.id
      );
      continue;
    }

    // 0.5) Pluggy Enrichment API category — highest-quality signal, skip LLM.
    //      Enrichment model has merchant-level training, better than the raw
    //      transaction category that comes with the Pluggy sync.
    const enrichedSlug = mapPluggyCategory(row.enrichedCategory);
    if (enrichedSlug) {
      const catId = slugToId.get(enrichedSlug);
      if (catId) {
        const isTransfer =
          enrichedSlug === "cartao_pagamento" || enrichedSlug === "transferencias";
        bucketAdd(
          {
            category_id: catId,
            is_transfer: isTransfer,
            ...(isTransfer ? { shared_amount: 0 } : {}),
            confidence: 0.95,
            ai_reasoning: "Categoria via Pluggy Enrichment API",
            status: "auto_accepted"
          },
          row.id
        );
        continue;
      }
    }

    // 0.6) Pluggy's own category as a prior → skip the LLM when it maps to one
    //      of our slugs (bank-grade, free, usually better than a desc-only guess).
    const pluggySlug = mapPluggyCategory(row.pluggyCategory);
    if (pluggySlug) {
      const catId = slugToId.get(pluggySlug);
      if (catId) {
        const isTransfer =
          pluggySlug === "cartao_pagamento" || pluggySlug === "transferencias";
        bucketAdd(
          {
            category_id: catId,
            is_transfer: isTransfer,
            ...(isTransfer ? { shared_amount: 0 } : {}),
            confidence: 0.9,
            ai_reasoning: "Categoria do Open Finance",
            status: "auto_accepted"
          },
          row.id
        );
        continue;
      }
    }

    // 1) Merchant rule (deterministic, no AI cost).
    const hit = categoryRules.find((rule) => matchesRulePattern(rule, descLower));
    if (hit) {
      // Pre-fill the suggested category but keep it staged (pending_review) —
      // the admin still accepts every row into the portal.
      bucketAdd(
        {
          category_id: hit.category_id as string,
          confidence: Number(hit.confidence_default) || 0.95,
          ai_reasoning: "Regra de fornecedor aplicada",
          status: "auto_accepted"
        },
        row.id
      );
    } else {
      remaining.push(row);
    }
  }

  // 2) AI batch for the rest. Each result carries a per-row reasoning string,
  //    but rows with the same category/confidence/reasoning still bucket.
  if (remaining.length > 0) {
    const queue: CategorizeInput[] = remaining.map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: r.amount
    }));
    const results = await categorizeAll(queue);
    for (const r of results) {
      const catId = slugToId.get(r.category_slug) ?? slugToId.get("outros");
      if (!catId) continue;
      const isTransfer =
        r.category_slug === "cartao_pagamento" || r.category_slug === "transferencias";
      // Pre-fill category but keep staged — admin accepts into the portal.
      bucketAdd(
        {
          category_id: catId,
          confidence: r.confidence,
          ai_reasoning: r.reasoning,
          status: "auto_accepted",
          is_transfer: isTransfer,
          ...(isTransfer ? { shared_amount: 0 } : {})
        },
        r.id
      );
    }
  }

  // 3) Apply the buckets — updates are independent, run them concurrently.
  let done = 0;
  await Promise.all(
    Array.from(buckets.values()).map(async ({ patch, ids }) => {
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { error } = await sb.from("transactions").update(patch).in("id", slice);
        if (error) {
          errors.push(`categorize update failed (${slice.length} rows): ${error.message}`);
        } else {
          done += slice.length;
        }
      }
    })
  );

  // 4) Reimbursement tags learned from merchant rules (Kenlo/Laik/Plano) —
  //    independent of the category buckets above, applied after so a
  //    hide-on-tag can't be clobbered by a category patch's own shared_amount.
  if (tagsToApply.length > 0) {
    const rows = tagsToApply.map((t) => ({
      transaction_id: t.transactionId,
      tag_id: t.tagId,
      status: "pending" as const
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await sb
        .from("transaction_reimbursements")
        .upsert(slice, { onConflict: "transaction_id,tag_id", ignoreDuplicates: true });
      if (error) errors.push(`transaction_reimbursements upsert failed (${slice.length} rows): ${error.message}`);
    }
  }
  if (hiddenIds.size > 0) {
    const ids = Array.from(hiddenIds);
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const { error } = await sb.from("transactions").update({ shared_amount: 0 }).in("id", slice);
      if (error) errors.push(`tag hide update failed (${slice.length} rows): ${error.message}`);
    }
  }

  return done;
}
