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
  cluster_a: { key: string; name: string; txCount: number };
  cluster_b: { key: string; name: string; txCount: number };
  similarity: number;
  shared_tokens: string[];
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
    tokens: Set<string>;
  };

  const byKey = new Map<string, ClusterAgg>();

  // Pull all (canonical_key, canonical_name) pairs from merchant_clusters
  let off = 0;
  while (true) {
    const { data, error } = await sb
      .from("merchant_clusters")
      .select("canonical_key, canonical_name, description_raw")
      .order("canonical_key", { ascending: true })
      .range(off, off + 999);
    if (error || !data || !data.length) break;
    for (const r of data) {
      const k = r.canonical_key as string;
      const n = r.canonical_name as string;
      if (!byKey.has(k)) {
        byKey.set(k, { key: k, name: n, txCount: 0, tokens: new Set(tokenize(n)) });
      }
    }
    if (data.length < 1000) break;
    off += 1000;
  }

  // Tx counts per cluster (joined via description_raw match)
  // We can do this approximately by counting merchant_clusters rows per key,
  // but that counts description variants not transactions. For real tx count
  // we'd need a join — too expensive here. Use distinct description count
  // as a proxy.
  off = 0;
  while (true) {
    const { data } = await sb
      .from("merchant_clusters")
      .select("canonical_key")
      .range(off, off + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      const c = byKey.get(r.canonical_key as string);
      if (c) c.txCount++;
    }
    if (data.length < 1000) break;
    off += 1000;
  }

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
          cluster_a: { key: a.key, name: a.name, txCount: a.txCount },
          cluster_b: { key: b.key, name: b.name, txCount: b.txCount },
          similarity: Number(sim.toFixed(2)),
          shared_tokens: shared
        });
      }
    }
  }

  // Sort: highest similarity first, then by combined transaction count
  suggestions.sort((x, y) => {
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    return (y.cluster_a.txCount + y.cluster_b.txCount) - (x.cluster_a.txCount + x.cluster_b.txCount);
  });

  return NextResponse.json({
    suggestions: suggestions.slice(0, 50),
    totalFound: suggestions.length,
    scanned: clusters.length
  });
}
