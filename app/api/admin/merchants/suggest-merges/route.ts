import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { serverClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Tokenizer — same algorithm as lib/merchants/clusters.ts, duplicated here
// because this route uses the canonical_name (display name) not description_raw.
const LEGAL_SUFFIX_RE =
  /\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|SS|SRL|CIA|INC|LLC|CORP|FILIAL|MATRIZ|UNID|LOJA|RJ|SP|MG|PR|RS|SC|BA|CE|GO|PE|AM|PA|DF)\b/g;

const NOISE_TOKENS = new Set([
  "PIX","PIXQR","QRS","QRD","QRDIN","CODE","CODIGO","PAGAMENTO","PAGTO","PG","PAG",
  "TRANSF","TRANSFERENCIA","TRF","TED","DOC","DEB","DEBITO","CRED","CREDITO",
  "BOLETO","COMPRA","SAQUE","DEPOSITO","DEP","FATURA","AUT","AUTOMATICO",
  "DE","DA","DO","DAS","DOS","PARA","PRA","REF","REFERENTE","VENDA"
]);

const MONTHS = new Set([
  "JANEIRO","FEVEREIRO","MARCO","MARÇO","ABRIL","MAIO","JUNHO",
  "JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO",
  "JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"
]);

function tokenize(s: string): string[] {
  return s
    .toUpperCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && /[A-Z]/.test(t))
    .filter((t) => !NOISE_TOKENS.has(t) && !MONTHS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const SUGGEST_THRESHOLD = 0.5;

type Suggestion = {
  cluster_a: { key: string; name: string; txCount: number; totalAbs: number };
  cluster_b: { key: string; name: string; txCount: number; totalAbs: number };
  similarity: number;
  shared_tokens: string[];
  combinedAbs: number;
};

// GET /api/admin/merchants/suggest-merges
//
// Scans all existing merchant clusters and surfaces pairs with high token
// similarity (≥ 0.5 Jaccard, threshold mirrors clusterLookup fuzzy).
//
// Returns: { suggestions: Suggestion[] } sorted by similarity DESC,
// transaction count tie-break. Truncated to top 50 to keep response small.
export async function GET() {
  await requireAdmin();
  const sb = serverClient();

  // Load all canonical clusters (one row per unique canonical_key with the
  // canonical_name and a count of descriptions belonging to it)
  type ClusterAgg = {
    key: string;
    name: string;
    txCount: number;
    totalAbs: number;
    tokens: Set<string>;
  };

  const byKey = new Map<string, ClusterAgg>();
  const descToKey = new Map<string, string>();

  // ONE paginated pass over merchant_clusters builds everything the old code
  // paged the same table three separate times for: name+tokens per key,
  // description-variant count (txCount proxy, as before), and the
  // description→key map for the spend join below.
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("merchant_clusters")
      .select("canonical_key, canonical_name, description_raw")
      .order("canonical_key", { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(`cluster scan failed: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      const k = r.canonical_key as string;
      const n = r.canonical_name as string;
      if (!byKey.has(k)) {
        byKey.set(k, { key: k, name: n, txCount: 0, totalAbs: 0, tokens: new Set(tokenize(n)) });
      }
      byKey.get(k)!.txCount++;
      descToKey.set(r.description_raw as string, k);
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  // Total spend per cluster — join transactions via description_raw.
  // Chunked to 200 descriptions per query (PG planner stays sane) AND
  // paginated: the old version passed up to 1000 descriptions and read the
  // matching transactions WITHOUT pagination, so past 1000 matches the R$
  // totals silently undercounted and mis-ranked the suggestions.
  // Also now excludes fake rows (is_fake) like every other spend total.
  const allDescs = [...descToKey.keys()];
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < allDescs.length; i += CHUNK) chunks.push(allDescs.slice(i, i + CHUNK));
  await Promise.all(
    chunks.map(async (slice) => {
      let toff = 0;
      while (true) {
        const { data: txRows, error } = await sb
          .from("transactions")
          .select("description_raw, real_amount")
          .in("description_raw", slice)
          .eq("is_transfer", false)
          .eq("is_fake", false)
          .order("id", { ascending: true })
          .range(toff, toff + 999);
        if (error) throw new Error(`spend join failed: ${error.message}`);
        for (const tx of txRows ?? []) {
          const ck = descToKey.get(tx.description_raw as string);
          const c = ck ? byKey.get(ck) : undefined;
          if (c) c.totalAbs += Math.abs(Number(tx.real_amount));
        }
        if (!txRows || txRows.length < 1000) break;
        toff += 1000;
      }
    })
  );

  // Pairwise comparison — O(n²) but n ≈ 1200 clusters → ~720k comparisons,
  // ~1 sec on Node. Acceptable for an on-demand admin tool.
  const clusters = [...byKey.values()].filter((c) => c.tokens.size > 0);
  const suggestions: Suggestion[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const a = clusters[i];
    for (let j = i + 1; j < clusters.length; j++) {
      const b = clusters[j];
      const sim = jaccard(a.tokens, b.tokens);
      if (sim >= SUGGEST_THRESHOLD) {
        const shared: string[] = [];
        for (const t of a.tokens) if (b.tokens.has(t)) shared.push(t);
        suggestions.push({
          cluster_a: { key: a.key, name: a.name, txCount: a.txCount, totalAbs: a.totalAbs },
          cluster_b: { key: b.key, name: b.name, txCount: b.txCount, totalAbs: b.totalAbs },
          similarity: Number(sim.toFixed(2)),
          shared_tokens: shared,
          combinedAbs: a.totalAbs + b.totalAbs
        });
      }
    }
  }

  // Sort: highest similarity first, then by combined R$ value (highest spend first)
  suggestions.sort((x, y) => {
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    return y.combinedAbs - x.combinedAbs;
  });

  return NextResponse.json({
    suggestions: suggestions.slice(0, 50),
    totalFound: suggestions.length,
    scanned: clusters.length
  });
}
