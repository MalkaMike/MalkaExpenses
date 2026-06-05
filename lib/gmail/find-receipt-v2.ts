import "server-only";
import { generateMerchantVariations } from "./merchant-variations";
import { textContainsAmount, snippet } from "./value-match";
import { extractAttachmentText } from "./extract-text";

// ============================================================================
// findReceiptsForTransactionV2 — value-verified nota fiscal lookup.
//
// Algorithm:
//   1. Generate 4-6 merchant name variations
//   2. For each variation, run Gmail search (±dayWindow days, receipt-y keywords)
//   3. Deduplicate by message ID
//   4. For each candidate message:
//        a. Pull subject + snippet from API metadata → cheap value check
//        b. If subject/preview contains the value → confidence "high"
//        c. Otherwise, if has PDF attachment, download + extract text →
//           if text contains value → confidence "verified"
//        d. Image attachments: OCR via Google Vision (if API key set)
//   5. Return ONLY messages where the value was found, sorted by confidence
// ============================================================================

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const RECEIPT_KEYWORDS = [
  '"nota fiscal"',
  '"nota fiscal eletrônica"',
  "nfe",
  "nfse",
  "invoice",
  "receipt",
  "recibo",
  "comprovante",
  "fatura",
  "boleto"
].join(" OR ");

function gmailDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

type GmailHeader = { name: string; value: string };

type GmailPart = {
  filename?: string;
  mimeType: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  payload: {
    headers: GmailHeader[];
    mimeType: string;
    filename?: string;
    body?: { attachmentId?: string; size?: number; data?: string };
    parts?: GmailPart[];
  };
};

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseFrom(from: string): { name: string | null; email: string } {
  const m = from.match(/^(?:"?([^"<]+?)"?\s*)?<([^>]+)>$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2] };
  return { name: null, email: from.trim() };
}

// Decode Gmail's URL-safe base64
function decodeBody(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Strip HTML tags, decode entities, collapse whitespace
function stripHtml(html: string): string {
  return html
    // Remove script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Add newlines around block elements so content doesn't run together
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

// Walk all body parts and extract the full text content (HTML + plain).
// Returns concatenated text — value-match runs over this combined string.
function extractEmailBody(payload: GmailMessage["payload"]): string {
  const chunks: string[] = [];

  const walk = (part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }) => {
    const mime = part.mimeType ?? "";
    if (part.body?.data) {
      if (mime.startsWith("text/plain")) {
        chunks.push(decodeBody(part.body.data));
      } else if (mime.startsWith("text/html")) {
        chunks.push(stripHtml(decodeBody(part.body.data)));
      }
    }
    if (Array.isArray(part.parts)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const child of part.parts as any[]) walk(child);
    }
  };

  walk(payload as unknown as { mimeType?: string; body?: { data?: string }; parts?: unknown[] });
  return chunks.join("\n");
}

// Walk all parts (recursive) yielding attachments
function* walkAttachments(payload: GmailMessage["payload"]): Generator<GmailPart> {
  const walk = function* (parts: GmailPart[] | undefined): Generator<GmailPart> {
    if (!parts) return;
    for (const p of parts) {
      if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
        yield p;
      }
      if (p.parts) yield* walk(p.parts);
    }
  };
  if (payload.filename && payload.body?.attachmentId) {
    yield {
      filename: payload.filename,
      mimeType: payload.mimeType,
      body: payload.body
    };
  }
  yield* walk(payload.parts);
}

async function downloadAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer | null> {
  const r = await fetch(`${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: string };
  if (!j.data) return null;
  // Gmail returns URL-safe base64
  const b64 = j.data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

export type ReceiptMatchV2 = {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  sentAt: string;
  hasAttachment: boolean;
  attachmentCount: number;
  /** "verified" = found in attached PDF/image | "high" = found in email body/subject */
  confidence: "verified" | "high";
  /** Where the value match came from */
  matchSource: "subject" | "snippet" | "email-body" | "pdf-text" | "vision-ocr" | "raw-text";
  /** Free-form reason for UI */
  matchReason: string;
  /** Context snippet around the matched value */
  matchSnippet: string;
  gmailUrl: string;
};

/** Main entry point — value-verified receipt search. */
export async function findReceiptsForTransactionV2(args: {
  accessToken: string;
  merchantName: string;
  date: string;             // ISO YYYY-MM-DD
  amount: number;           // ABS value in BRL (e.g. 1234.56)
  dayWindow?: number;       // ±days; default 7 (wider than v1 because we filter by value)
  max?: number;             // max results returned; default 5
}): Promise<ReceiptMatchV2[]> {
  const dayWindow = args.dayWindow ?? 7;
  const max = args.max ?? 5;
  const absAmount = Math.abs(args.amount);

  const center = new Date(args.date);
  const after = new Date(center);
  after.setUTCDate(center.getUTCDate() - dayWindow);
  const before = new Date(center);
  before.setUTCDate(center.getUTCDate() + dayWindow + 1);

  const variations = generateMerchantVariations(args.merchantName);
  if (variations.length === 0) return [];

  // 1. Search each variation, collect unique message IDs
  const messageIds = new Set<string>();
  const messageIdToThread = new Map<string, string>();

  for (const variation of variations) {
    const q = `${variation} (${RECEIPT_KEYWORDS}) after:${gmailDate(after)} before:${gmailDate(before)}`;
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", "10");
    try {
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${args.accessToken}` }
      });
      if (!r.ok) continue;
      const list = (await r.json()) as {
        messages?: Array<{ id: string; threadId: string }>;
      };
      for (const m of list.messages ?? []) {
        messageIds.add(m.id);
        messageIdToThread.set(m.id, m.threadId);
      }
    } catch {
      // Continue with other variations on transient errors
    }
    // Stop early if we already have plenty of candidates
    if (messageIds.size >= 25) break;
  }

  if (messageIds.size === 0) return [];

  // 2. For each unique candidate, fetch FULL message + verify value
  const matches: ReceiptMatchV2[] = [];
  for (const msgId of messageIds) {
    if (matches.length >= max) break;
    try {
      const r = await fetch(`${GMAIL_API}/messages/${msgId}?format=full`, {
        headers: { Authorization: `Bearer ${args.accessToken}` }
      });
      if (!r.ok) continue;
      const msg = (await r.json()) as GmailMessage;

      const subject = header(msg.payload.headers, "Subject");
      const from = parseFrom(header(msg.payload.headers, "From"));
      const sentAt = new Date(Number(msg.internalDate)).toISOString();
      const gmailSnippet = msg.snippet ?? "";

      // ── Layer 1: subject/snippet (cheap, no download) ────────────────────
      const subjMatch = textContainsAmount(subject, absAmount);
      if (subjMatch.found && subjMatch.match) {
        matches.push({
          gmailMessageId: msg.id,
          gmailThreadId: msg.threadId,
          subject,
          fromEmail: from.email,
          fromName: from.name,
          sentAt,
          hasAttachment: false,
          attachmentCount: 0,
          confidence: "high",
          matchSource: "subject",
          matchReason: `Valor R$ ${subjMatch.match.raw.replace(/R\$\s*/i, "")} encontrado no assunto`,
          matchSnippet: snippet(subject, subjMatch.match.pos, 40),
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
        });
        continue;
      }
      const snipMatch = textContainsAmount(gmailSnippet, absAmount);
      if (snipMatch.found && snipMatch.match) {
        matches.push({
          gmailMessageId: msg.id,
          gmailThreadId: msg.threadId,
          subject,
          fromEmail: from.email,
          fromName: from.name,
          sentAt,
          hasAttachment: false,
          attachmentCount: 0,
          confidence: "high",
          matchSource: "snippet",
          matchReason: `Valor encontrado no preview do email`,
          matchSnippet: snippet(gmailSnippet, snipMatch.match.pos, 40),
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
        });
        continue;
      }

      // ── Layer 2: FULL email body (HTML + plain text) ────────────────────
      // Most Brazilian invoice emails put the value in the HTML body, not in
      // the snippet/preview. An email with the matching value IS proof —
      // a PDF attachment is just additional confirmation.
      const bodyText = extractEmailBody(msg.payload);
      if (bodyText) {
        const bodyMatch = textContainsAmount(bodyText, absAmount);
        if (bodyMatch.found && bodyMatch.match) {
          const attachmentCount = Array.from(walkAttachments(msg.payload)).length;
          matches.push({
            gmailMessageId: msg.id,
            gmailThreadId: msg.threadId,
            subject,
            fromEmail: from.email,
            fromName: from.name,
            sentAt,
            hasAttachment: attachmentCount > 0,
            attachmentCount,
            confidence: "high",
            matchSource: "email-body",
            matchReason: `Valor encontrado no corpo do email`,
            matchSnippet: snippet(bodyText, bodyMatch.match.pos, 70),
            gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
          });
          continue;
        }
      }

      // ── Layer 3: attachments — download + extract + check value ─────────
      const attachments = Array.from(walkAttachments(msg.payload));
      let attachmentMatchFound = false;
      for (const att of attachments) {
        if (!att.body?.attachmentId) continue;
        const buf = await downloadAttachment(args.accessToken, msg.id, att.body.attachmentId);
        if (!buf) continue;
        const { text, method } = await extractAttachmentText(
          buf,
          att.mimeType,
          att.filename
        );
        if (!text) continue;
        const attMatch = textContainsAmount(text, absAmount);
        if (attMatch.found && attMatch.match) {
          matches.push({
            gmailMessageId: msg.id,
            gmailThreadId: msg.threadId,
            subject,
            fromEmail: from.email,
            fromName: from.name,
            sentAt,
            hasAttachment: true,
            attachmentCount: attachments.length,
            confidence: "verified",
            matchSource: method === "pdf-text" ? "pdf-text" : method === "vision-ocr" ? "vision-ocr" : "raw-text",
            matchReason: `Valor confirmado em ${att.filename ?? "anexo"} (${method === "pdf-text" ? "texto do PDF" : method === "vision-ocr" ? "OCR" : "texto"})`,
            matchSnippet: snippet(text, attMatch.match.pos, 60),
            gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
          });
          attachmentMatchFound = true;
          break;
        }
      }
      if (attachmentMatchFound) continue;

      // Value not found anywhere → SKIP this message (per user request:
      // only show emails where the value matches)
    } catch {
      // Continue with other messages
    }
  }

  // Sort: verified (PDF/OCR) above high (subject/snippet)
  matches.sort((a, b) => {
    const score = (m: ReceiptMatchV2) => (m.confidence === "verified" ? 2 : 1);
    return score(b) - score(a);
  });

  return matches.slice(0, max);
}
