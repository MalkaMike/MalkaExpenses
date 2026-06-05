import "server-only";

// ============================================================================
// Gmail search — finds nota fiscal / invoice emails matching a transaction.
//
// Strategy:
//   1. Build a Gmail search query combining date range + merchant tokens
//      + receipt keywords (nota fiscal, invoice, recibo, comprovante)
//   2. Score each match: token overlap with merchant name + attachment bonus
//   3. Return top N with subject, sender, date, attachment info, Gmail URL
// ============================================================================

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const RECEIPT_KEYWORDS = [
  "\"nota fiscal\"",
  "\"nota fiscal eletrônica\"",
  "nfe",
  "invoice",
  "recibo",
  "comprovante",
  "fatura",
  "boleto"
].join(" OR ");

const LEGAL_SUFFIX_RE =
  /\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|SS|SRL|CIA|INC|LLC|CORP|FILIAL|MATRIZ|UNID|LOJA|RJ|SP|MG|PR|RS|SC|BA|CE|GO|PE|AM|PA|DF)\b/gi;

const NOISE_TOKENS = new Set([
  "PIX","PIXQR","QRS","QRD","QRDIN","CODE","CODIGO","PAGAMENTO","PAGTO","PG","PAG",
  "TRANSF","TRANSFERENCIA","TRF","TED","DOC","DEB","DEBITO","CRED","CREDITO",
  "BOLETO","COMPRA","SAQUE","DEPOSITO","DEP","FATURA","AUT","AUTOMATICO",
  "DE","DA","DO","DAS","DOS","PARA","PRA","REF","REFERENTE","VENDA"
]);

function cleanMerchant(name: string): string[] {
  return name
    .toUpperCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && /[A-Z]/.test(t))
    .filter((t) => !NOISE_TOKENS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Format a date as Gmail's "after:YYYY/MM/DD" / "before:YYYY/MM/DD" filter. */
function gmailDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export type ReceiptMatch = {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  sentAt: string;            // ISO
  hasAttachment: boolean;
  attachmentCount: number;
  matchScore: number;        // 0..1
  matchReason: string;
  gmailUrl: string;          // direct link to message in Gmail web
};

type GmailListResp = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
};

type GmailHeader = { name: string; value: string };

type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;       // epoch millis as string
  payload: {
    headers: GmailHeader[];
    mimeType: string;
    filename?: string;
    parts?: Array<{
      filename?: string;
      mimeType: string;
      body?: { attachmentId?: string; size?: number };
      parts?: GmailMessage["payload"]["parts"];
    }>;
  };
};

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseFrom(from: string): { name: string | null; email: string } {
  // "Name <email@x.com>" or just "email@x.com"
  const m = from.match(/^(?:"?([^"<]+?)"?\s*)?<([^>]+)>$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2] };
  return { name: null, email: from.trim() };
}

function countAttachments(payload: GmailMessage["payload"]): number {
  let n = 0;
  const walk = (parts: GmailMessage["payload"]["parts"]) => {
    if (!parts) return;
    for (const p of parts) {
      if (p.filename && p.filename.length > 0 && p.body?.attachmentId) n++;
      if (p.parts) walk(p.parts);
    }
  };
  walk(payload.parts);
  if (payload.filename && payload.filename.length > 0) n++;
  return n;
}

/** Search Gmail for emails matching a transaction. */
export async function findReceiptsForTransaction(args: {
  accessToken: string;
  merchantName: string;
  date: string;                // ISO date
  dayWindow?: number;          // ± days; default 3
  max?: number;                // max results to return; default 5
}): Promise<ReceiptMatch[]> {
  const dayWindow = args.dayWindow ?? 3;
  const max = args.max ?? 5;

  const center = new Date(args.date);
  const after = new Date(center);
  after.setUTCDate(center.getUTCDate() - dayWindow);
  const before = new Date(center);
  before.setUTCDate(center.getUTCDate() + dayWindow + 1); // Gmail "before" is exclusive

  const tokens = cleanMerchant(args.merchantName);
  if (tokens.length === 0) return [];

  // Gmail query: merchant tokens (OR) AND receipt keywords AND date range
  const merchantOr = tokens.map((t) => `"${t}"`).join(" OR ");
  const q = `(${merchantOr}) (${RECEIPT_KEYWORDS}) after:${gmailDate(after)} before:${gmailDate(before)}`;

  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(Math.max(max * 3, 10))); // overshoot for scoring

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${args.accessToken}` }
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Gmail list failed (${r.status}): ${text}`);
  }
  const list = (await r.json()) as GmailListResp;
  if (!list.messages?.length) return [];

  // Fetch full message metadata for each in parallel
  const messageIds = list.messages.slice(0, Math.min(list.messages.length, 20));
  const messages = await Promise.all(
    messageIds.map(async (m) => {
      const r2 = await fetch(
        `${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${args.accessToken}` } }
      );
      if (!r2.ok) return null;
      // metadata format doesn't include parts → fetch full for attachment count
      const full = await fetch(`${GMAIL_API}/messages/${m.id}?format=full`, {
        headers: { Authorization: `Bearer ${args.accessToken}` }
      });
      if (!full.ok) return null;
      return (await full.json()) as GmailMessage;
    })
  );

  const valid = messages.filter((m): m is GmailMessage => m !== null);

  const matches: ReceiptMatch[] = valid.map((msg) => {
    const subject = header(msg.payload.headers, "Subject");
    const from = parseFrom(header(msg.payload.headers, "From"));
    const sentAt = new Date(Number(msg.internalDate)).toISOString();
    const attachmentCount = countAttachments(msg.payload);

    // Score: merchant token overlap with subject + sender name + sender domain
    const subjectTokens = cleanMerchant(subject);
    const fromNameTokens = from.name ? cleanMerchant(from.name) : [];
    const fromDomainTokens = cleanMerchant(from.email.split("@")[1] ?? "");
    const subjectScore = jaccard(tokens, subjectTokens);
    const fromNameScore = jaccard(tokens, fromNameTokens);
    const fromDomainScore = jaccard(tokens, fromDomainTokens);
    const tokenScore = Math.max(subjectScore, fromNameScore, fromDomainScore);

    // Attachment bonus: 0 = +0, 1+ = +0.2
    const attachBonus = attachmentCount > 0 ? 0.2 : 0;
    const score = Math.min(1, tokenScore + attachBonus);

    const reasonParts: string[] = [];
    if (tokenScore > 0) reasonParts.push(`token match ${(tokenScore * 100).toFixed(0)}%`);
    if (attachmentCount > 0) reasonParts.push(`${attachmentCount} anexo${attachmentCount > 1 ? "s" : ""}`);

    return {
      gmailMessageId: msg.id,
      gmailThreadId: msg.threadId,
      subject,
      fromEmail: from.email,
      fromName: from.name,
      sentAt,
      hasAttachment: attachmentCount > 0,
      attachmentCount,
      matchScore: Number(score.toFixed(2)),
      matchReason: reasonParts.join(" · ") || "keyword match",
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
    };
  });

  // Sort by score desc; keep top `max`
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches.slice(0, max);
}
