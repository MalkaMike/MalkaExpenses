import "server-only";
import type { serverClient } from "@/lib/supabase/server";
import {
  getItem,
  listAccounts,
  listTransactions,
  signedAmount,
  mapAccountType,
  mapBankKey,
  type PluggyTransaction
} from "@/lib/pluggy/client";
import { categorizeAll, type CategorizeInput } from "@/lib/ai/categorize";
import { isCcPaymentDescription } from "@/lib/reconciliation/cc-matcher";

type SB = ReturnType<typeof serverClient>;

export type PluggySyncResult = {
  accounts: number;
  inserted: number;
  categorized: number;
  reconciled: number;
  perAccount: Array<{ accountName: string; inserted: number }>;
};

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

// How far back to pull on the first sync of an account.
function defaultFromDate(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
}

// Incremental window with overlap: re-pull a few days before the last sync so
// late-posting transactions (dated before our last run but posted after) aren't
// missed. The external_id dedup makes the overlap free of duplicates.
function incrementalFromDate(lastSyncIso: string, overlapDays = 7): string {
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
    categorized: 0,
    reconciled: 0,
    perAccount: []
  };

  for (const pa of pluggyAccounts) {
    // 1) Find or create the Casa account for this Pluggy account.
    const { data: existing } = await sb
      .from("accounts")
      .select("id, pluggy_last_sync")
      .eq("pluggy_account_id", pa.id)
      .maybeSingle();

    let accountId: string;
    let isNew = false;
    let lastSync: string | null = existing?.pluggy_last_sync ?? null;

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
      if (createErr || !created) continue; // surfaced via lower count; never throw mid-loop
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
    } catch {
      // One account failing shouldn't abort the whole item.
      continue;
    }

    // 3) Dedup against already-imported pluggy ids for this account.
    const { data: existingTx } = await sb
      .from("transactions")
      .select("external_id")
      .eq("account_id", accountId)
      .eq("source", "pluggy");
    const seen = new Set((existingTx ?? []).map((r) => r.external_id as string));

    const newRows = pluggyTx
      .filter((t) => !seen.has(t.id))
      .map((t) => {
        const amt = signedAmount(t);
        const desc = t.description || t.descriptionRaw || "—";
        return {
          account_id: accountId,
          date: isoToDate(t.date),
          description_raw: desc,
          description_clean: desc,
          real_amount: amt,
          // Staged: shared_amount=0 keeps it OUT of the household portal (the
          // security view filters shared_amount<>0) until the admin accepts it.
          shared_amount: 0,
          source: "pluggy" as const,
          status: "pending_review" as const,
          created_by: "import" as const,
          external_id: t.id
        };
      });

    let insertedIds: Array<{ id: string; date: string; description: string; amount: number }> = [];
    if (newRows.length > 0) {
      const { data: ins, error: insErr } = await sb
        .from("transactions")
        .insert(newRows)
        .select("id, date, description_raw, real_amount");
      if (!insErr && ins) {
        insertedIds = ins.map((r) => ({
          id: r.id as string,
          date: r.date as string,
          description: r.description_raw as string,
          amount: Number(r.real_amount)
        }));
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
      const starting = Number((pa.balance - sumImported).toFixed(2));
      await sb
        .from("accounts")
        .update({ real_starting_balance: starting, shared_starting_balance: 0 })
        .eq("id", accountId);
    }

    // 5) Categorize the new rows with the existing AI pipeline (merchant rules
    //    first, then Gemini batch). Skipped if nothing new.
    if (insertedIds.length > 0) {
      try {
        result.categorized += await categorizeFresh(sb, insertedIds);
      } catch {
        // categorization failure is non-fatal — rows stay pending_review.
      }
    }

    await sb.from("accounts").update({ pluggy_last_sync: new Date().toISOString() }).eq("id", accountId);
  }

  // Note: CC reconciliation is NOT run here — synced rows stay in the admin
  // acceptance inbox until reviewed. Reconcile is a separate admin action.
  return result;
}

// Merchant-rules pre-pass + AI batch for freshly-synced rows.
async function categorizeFresh(
  sb: SB,
  rows: Array<{ id: string; date: string; description: string; amount: number }>
): Promise<number> {
  // Merchant rules first (deterministic, no AI cost).
  const { data: rules } = await sb
    .from("merchant_rules")
    .select("pattern, pattern_type, category_id, confidence_default")
    .order("hit_count", { ascending: false });

  // Resolve slug → id once (used for CC-payment detection + AI results).
  const { data: cats } = await sb.from("categories").select("id, slug");
  const slugToId = new Map<string, string>();
  for (const c of cats ?? []) slugToId.set(c.slug as string, c.id as string);
  const ccPayId = slugToId.get("cartao_pagamento");

  const remaining: typeof rows = [];
  let done = 0;
  for (const row of rows) {
    // 0) Credit-card BILL PAYMENT → it's a transfer, not a real expense
    //    (the card purchases already arrive on the card account). Mark it so it
    //    doesn't double-count. Deterministic — runs before merchant rules / AI.
    if (ccPayId && isCcPaymentDescription(row.description)) {
      await sb
        .from("transactions")
        .update({
          category_id: ccPayId,
          is_transfer: true,
          confidence: 0.99,
          ai_reasoning: "Pagamento de cartão — marcado como transferência",
          status: "pending_review"
        })
        .eq("id", row.id);
      done += 1;
      continue;
    }

    // 1) Merchant rule (deterministic, no AI cost).
    const desc = row.description.toLowerCase();
    const hit = (rules ?? []).find((rule) => {
      const pat = rule.pattern.toLowerCase();
      if (rule.pattern_type === "exact") return desc === pat;
      if (rule.pattern_type === "starts_with") return desc.startsWith(pat);
      return desc.includes(pat);
    });
    if (hit) {
      // Pre-fill the suggested category but keep it staged (pending_review) —
      // the admin still accepts every row into the portal.
      await sb
        .from("transactions")
        .update({
          category_id: hit.category_id,
          confidence: Number(hit.confidence_default) || 0.95,
          ai_reasoning: "Regra de fornecedor aplicada",
          status: "pending_review"
        })
        .eq("id", row.id);
      done += 1;
    } else {
      remaining.push(row);
    }
  }

  if (remaining.length === 0) return done;

  // 2) AI batch for the rest.
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
    await sb
      .from("transactions")
      .update({
        category_id: catId,
        confidence: r.confidence,
        ai_reasoning: r.reasoning,
        status: "pending_review",
        is_transfer: isTransfer
      })
      .eq("id", r.id);
    done += 1;
  }

  return done;
}
