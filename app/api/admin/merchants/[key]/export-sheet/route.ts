import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";
import { rawDescriptionsForKeyDirect, preloadClusters, clusterFor } from "@/lib/merchants/clusters";
import { getValidAccessToken } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

// ============================================================================
// POST /api/admin/merchants/[key]/export-sheet
//
// Creates a Google Spreadsheet with the merchant's full transaction history
// and returns the URL. Each role uses their own connected Google account, so
// the sheet lands in the caller's Drive.
//
// Access: admin and health roles.
// Auth: role's Google OAuth must be connected (/api/auth/gmail/connect).
//
// Response:
//   200  { url: string }         — spreadsheetUrl from Sheets API
//   403  { error }               — wrong role
//   404  { error }               — merchant key not found
//   412  { error, needsAuth: true } — Google not connected for this role
//   500  { error }               — DB or Sheets API failure
// ============================================================================

type TxRow = {
  id: string;
  date: string;
  description_raw: string;
  description_clean: string | null;
  real_amount: number;
  shared_amount: number;
  category_id: string | null;
  account_id: string;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const role = await getRole();
  if (role !== "admin" && role !== "health") {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }

  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);

  // ── 1. Ensure this role has a Google account connected ──────────────────────
  const token = await getValidAccessToken(role);
  if (!token) {
    return NextResponse.json(
      {
        error: "Conta Google não conectada. Clique em 'Conectar Google' para autorizar.",
        needsAuth: true
      },
      { status: 412 }
    );
  }

  // ── 2. Resolve raw descriptions for this merchant cluster ──────────────────
  const sb = serverClient();
  await preloadClusters();
  const rawDescs = await rawDescriptionsForKeyDirect(key);
  if (rawDescs.length === 0) {
    return NextResponse.json({ error: "Comerciante não encontrado" }, { status: 404 });
  }

  // ── 3. Fetch transactions (same paginated pattern as detail page) ───────────
  const txs: TxRow[] = [];
  const DESC_CHUNK = 200;
  for (let i = 0; i < rawDescs.length; i += DESC_CHUNK) {
    const slice = rawDescs.slice(i, i + DESC_CHUNK);
    let off = 0;
    while (true) {
      const { data, error } = await sb
        .from("transactions")
        .select("id, date, description_raw, description_clean, real_amount, shared_amount, category_id, account_id")
        .in("description_raw", slice)
        .eq("is_fake", false)
        .order("date", { ascending: false })
        .order("id", { ascending: true })
        .range(off, off + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || !data.length) break;
      txs.push(...(data as TxRow[]));
      if (data.length < 1000) break;
      off += 1000;
    }
  }

  // ── 4. Look up category + account names ────────────────────────────────────
  const [{ data: cats }, { data: accounts }] = await Promise.all([
    sb.from("categories").select("id, name"),
    sb.from("accounts").select("id, name")
  ]);
  const catById     = new Map<string, string>();
  const accountById = new Map<string, string>();
  for (const c of cats     ?? []) catById    .set(c.id as string, c.name as string);
  for (const a of accounts ?? []) accountById.set(a.id as string, a.name as string);

  const merchantName = txs.length > 0 ? clusterFor(txs[0].description_raw).name : key;

  // ── 5. Build Google Sheets payload ─────────────────────────────────────────
  // Admin sees both real_amount and shared_amount.
  // Health (Ayelet) sees shared_amount only (same view as her portal).
  const isAdmin = role === "admin";

  const headers = isAdmin
    ? ["Data", "Fornecedor", "Nome original (banco)", "Conta", "Categoria", "Montante real (R$)", "Visível para Ayelet (R$)"]
    : ["Data", "Fornecedor", "Nome original (banco)", "Conta", "Categoria", "Montante (R$)"];

  const colWidths = isAdmin
    ? [90, 220, 220, 150, 130, 130, 130]
    : [90, 220, 220, 150, 130, 130];

  // Header row: bold + light gray background
  const headerRow = {
    values: headers.map((h) => ({
      userEnteredValue: { stringValue: h },
      userEnteredFormat: {
        textFormat: { bold: true },
        backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }
      }
    }))
  };

  // Data rows
  const dataRows = txs.map((t) => {
    // YYYY-MM-DD → DD/MM/YYYY (Brazilian convention)
    const dateStr = t.date ? t.date.split("-").reverse().join("/") : "";
    const displayName = t.description_clean ?? t.description_raw;
    const catName  = t.category_id ? catById.get(t.category_id)     ?? "—" : "—";
    const accName  = accountById.get(t.account_id) ?? "—";
    const realAmt  = Number(t.real_amount);
    const shared   = Number(t.shared_amount);

    const cols = isAdmin
      ? [
          { userEnteredValue: { stringValue: dateStr } },
          { userEnteredValue: { stringValue: displayName } },
          { userEnteredValue: { stringValue: t.description_raw } },
          { userEnteredValue: { stringValue: accName } },
          { userEnteredValue: { stringValue: catName } },
          { userEnteredValue: { numberValue: realAmt } },
          { userEnteredValue: { numberValue: shared } }
        ]
      : [
          { userEnteredValue: { stringValue: dateStr } },
          { userEnteredValue: { stringValue: displayName } },
          { userEnteredValue: { stringValue: t.description_raw } },
          { userEnteredValue: { stringValue: accName } },
          { userEnteredValue: { stringValue: catName } },
          { userEnteredValue: { numberValue: shared } }
        ];

    return { values: cols };
  });

  const sheetBody = {
    properties: {
      title: `${merchantName} — Transações`,
      locale: "pt_BR"
    },
    sheets: [{
      properties: {
        title: "Transações",
        gridProperties: {
          frozenRowCount: 1,
          columnCount: headers.length,
          rowCount: txs.length + 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [headerRow, ...dataRows],
        columnMetadata: colWidths.map((w) => ({ pixelSize: w }))
      }]
    }]
  };

  // ── 6. Call Google Sheets API ──────────────────────────────────────────────
  const sheetResp = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(sheetBody)
  });

  if (!sheetResp.ok) {
    const errText = await sheetResp.text();
    return NextResponse.json(
      { error: `Google Sheets API ${sheetResp.status}: ${errText}` },
      { status: 500 }
    );
  }

  const sheetJson = (await sheetResp.json()) as { spreadsheetUrl: string };
  return NextResponse.json({ url: sheetJson.spreadsheetUrl });
}
