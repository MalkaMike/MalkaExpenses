import "server-only";
import { getValidAccessToken } from "./oauth";

// ============================================================================
// Gmail send — bare-metal POST to /gmail/v1/users/me/messages/send with a
// base64url-encoded RFC-2822 MIME message. Used by the health-email outbox
// worker to deliver claim packages to Celina.
//
// Requires the gmail.send scope on the connected refresh token (see oauth.ts).
// If Mickael only re-consented with the old read-only scope, the API will
// return 403 with "Request had insufficient authentication scopes" — the
// worker surfaces that error so /admin/health can show a "Re-consent Gmail" CTA.
// ============================================================================

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type Attachment = {
  filename: string;
  mime_type: string;
  /** Raw bytes — caller fetched from disk or Supabase Storage. */
  bytes: Buffer;
};

export type SendInput = {
  to: string;
  subject: string;
  /** HTML body. Plain-text fallback is auto-derived. */
  body_html: string;
  attachments?: Attachment[];
};

export type SendResult = {
  message_id: string;
  thread_id?: string;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, " • ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildMime(input: SendInput, fromEmail: string): Buffer {
  const boundaryMixed = "mixed_" + Math.random().toString(36).slice(2, 10);
  const boundaryAlt = "alt_" + Math.random().toString(36).slice(2, 10);
  const plain = htmlToPlain(input.body_html);

  // RFC-2047 encode subject so non-ASCII (acentos) survives.
  const subjectEnc = "=?UTF-8?B?" + Buffer.from(input.subject, "utf8").toString("base64") + "?=";

  const parts: string[] = [
    `From: ${fromEmail}`,
    `To: ${input.to}`,
    `Subject: ${subjectEnc}`,
    "MIME-Version: 1.0",
  ];

  const hasAttachments = !!input.attachments?.length;
  if (hasAttachments) {
    parts.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
    parts.push("");
    parts.push(`--${boundaryMixed}`);
    parts.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
    parts.push("");
  } else {
    parts.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
    parts.push("");
  }

  parts.push(`--${boundaryAlt}`);
  parts.push("Content-Type: text/plain; charset=UTF-8");
  parts.push("Content-Transfer-Encoding: 8bit");
  parts.push("");
  parts.push(plain);
  parts.push("");
  parts.push(`--${boundaryAlt}`);
  parts.push("Content-Type: text/html; charset=UTF-8");
  parts.push("Content-Transfer-Encoding: 8bit");
  parts.push("");
  parts.push(input.body_html);
  parts.push("");
  parts.push(`--${boundaryAlt}--`);

  if (hasAttachments && input.attachments) {
    for (const att of input.attachments) {
      parts.push("");
      parts.push(`--${boundaryMixed}`);
      parts.push(`Content-Type: ${att.mime_type}; name="${att.filename}"`);
      parts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      parts.push("Content-Transfer-Encoding: base64");
      parts.push("");
      // Gmail accepts plain base64 (with line breaks) in MIME parts.
      parts.push(att.bytes.toString("base64").replace(/(.{76})/g, "$1\n"));
    }
    parts.push("");
    parts.push(`--${boundaryMixed}--`);
  }

  return Buffer.from(parts.join("\r\n"), "utf8");
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const cred = await getValidAccessToken();
  if (!cred) {
    throw new Error("Gmail not connected — re-consent required");
  }
  const fromEmail = cred.email ?? "me";

  const mime = buildMime(input, fromEmail);
  const body = JSON.stringify({ raw: b64url(mime) });

  const resp = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred.accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`gmail.send ${resp.status}: ${text.slice(0, 400)}`);
  }
  const j = (await resp.json()) as { id?: string; threadId?: string };
  if (!j.id) throw new Error("gmail.send: no message id in response");
  return { message_id: j.id, thread_id: j.threadId };
}
