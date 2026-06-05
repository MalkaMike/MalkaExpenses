import "server-only";

// ============================================================================
// Merchant name variations — generates the set of search terms to try in
// Gmail. We want to cast a wide net (catch alt names, legal entities,
// holdings) but each variation is a separate query.
// ============================================================================

const LEGAL_SUFFIX_RE =
  /\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|SS|SRL|CIA|INC|LLC|CORP|FILIAL|MATRIZ|UNID|LOJA|RJ|SP|MG|PR|RS|SC|BA|CE|GO|PE|AM|PA|DF)\b/gi;

const NOISE_TOKENS = new Set([
  "PIX","PIXQR","QRS","QRD","QRDIN","CODE","CODIGO","PAGAMENTO","PAGTO","PG","PAG",
  "TRANSF","TRANSFERENCIA","TRF","TED","DOC","DEB","DEBITO","CRED","CREDITO",
  "BOLETO","COMPRA","SAQUE","DEPOSITO","DEP","FATURA","AUT","AUTOMATICO",
  "DE","DA","DO","DAS","DOS","PARA","PRA","REF","REFERENTE","VENDA"
]);

const CONNECTOR_WORDS = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "PARA", "COM", "POR"
]);

/** Generate 4-6 variations of the merchant name to search.
 *  Each returned string is a Gmail query (no quotes added — caller decides). */
export function generateMerchantVariations(name: string): string[] {
  const variations = new Set<string>();
  const cleaned = name.trim();

  // 1. Full original (display name) — quoted phrase
  variations.add(`"${cleaned}"`);

  // 2. Without legal suffixes
  const noLegal = cleaned.replace(LEGAL_SUFFIX_RE, " ").replace(/\s+/g, " ").trim();
  if (noLegal && noLegal !== cleaned) variations.add(`"${noLegal}"`);

  // 3. Tokens — letter words ≥ 3 chars, no noise, no connectors
  const tokens = cleaned
    .toUpperCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && /[A-Z]/.test(t))
    .filter((t) => !NOISE_TOKENS.has(t) && !CONNECTOR_WORDS.has(t));

  // 4. First two meaningful tokens together (e.g. "Einstein Morumbi")
  if (tokens.length >= 2) {
    variations.add(`"${tokens[0]} ${tokens[1]}"`);
  }

  // 5. Single dominant token (e.g. just "Einstein" or "Latam")
  if (tokens.length >= 1 && tokens[0].length >= 5) {
    variations.add(tokens[0]);
  }

  // 6. Two tokens with AND (for emails where they appear apart)
  if (tokens.length >= 2) {
    variations.add(`${tokens[0]} ${tokens[1]}`);
  }

  return Array.from(variations).slice(0, 6);
}
