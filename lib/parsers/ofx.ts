// OFX parser: convert OFX/QFX file content to normalized transaction rows.
// Hand-rolled rather than relying on the npm package — OFX is simple SGML
// and our needs are narrow. Works with both SGML (legacy) and XML OFX.

export type ParsedOfxTransaction = {
  externalId: string | null; // FITID
  date: string; // ISO YYYY-MM-DD
  amount: number; // negative = debit, positive = credit
  description: string; // MEMO || NAME
  type: string | null; // TRNTYPE
};

export type ParsedOfx = {
  openingBalance: number | null; // BALAMT from LEDGERBAL, if present
  closingBalance: number | null; // bank-reported AVAILBAL or LEDGERBAL
  currency: string | null;
  transactions: ParsedOfxTransaction[];
};

function stripOfxHeaders(raw: string): string {
  // OFX SGML files begin with key:value headers, blank line, then SGML body.
  // OFX XML files begin with an XML processing instruction.
  // Find the first "<" and slice from there.
  const lt = raw.indexOf("<");
  return lt < 0 ? raw : raw.slice(lt);
}

// Convert OFX SGML (unclosed tags) into well-formed XML-ish: <TAG>value</TAG>.
// Approach: for each line of form `<TAG>VALUE` (no closing tag, no nested
// element), append `</TAG>`. Lines that already contain `</` or open a
// container element are left alone.
function sgmlToXml(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      // already closed or just a closing tag
      if (t.startsWith("</")) return t;
      // container opening tag (no content after) like "<STMTTRN>"
      const opener = t.match(/^<([A-Z0-9_.]+)>$/);
      if (opener) return t;
      // value tag like "<NAME>Lorem ipsum"
      const m = t.match(/^<([A-Z0-9_.]+)>(.*)$/);
      if (m) {
        const [, tag, value] = m;
        return `<${tag}>${escapeXml(value)}</${tag}>`;
      }
      return t;
    })
    .join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTagAll(body: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

function getTag(body: string, tag: string): string | null {
  const a = getTagAll(body, tag);
  return a.length ? a[0] : null;
}

function parseOfxDate(d: string): string | null {
  // OFX dates: YYYYMMDD or YYYYMMDDHHMMSS[.XXX][TZ]
  const m = d.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function parseOfx(raw: string): ParsedOfx {
  const body = sgmlToXml(stripOfxHeaders(raw));

  const transactions: ParsedOfxTransaction[] = [];
  const stmttrnBlocks = getTagAll(body, "STMTTRN");
  for (const block of stmttrnBlocks) {
    const dtPosted = getTag(block, "DTPOSTED");
    const trnAmt = getTag(block, "TRNAMT");
    const fitId = getTag(block, "FITID");
    const memo = getTag(block, "MEMO");
    const name = getTag(block, "NAME");
    const trnType = getTag(block, "TRNTYPE");
    if (!dtPosted || !trnAmt) continue;
    const date = parseOfxDate(dtPosted);
    if (!date) continue;
    const amount = Number(trnAmt.replace(",", "."));
    if (Number.isNaN(amount)) continue;
    const description = decode(memo ?? name ?? "");
    transactions.push({
      externalId: fitId ? decode(fitId) : null,
      date,
      amount,
      description,
      type: trnType ? decode(trnType) : null
    });
  }

  const ledgerBalAmt = getTag(body, "LEDGERBAL")
    ? getTag(getTag(body, "LEDGERBAL")!, "BALAMT")
    : null;
  const availBalAmt = getTag(body, "AVAILBAL")
    ? getTag(getTag(body, "AVAILBAL")!, "BALAMT")
    : null;

  return {
    openingBalance: null, // OFX usually only reports current balance
    closingBalance: ledgerBalAmt
      ? Number(ledgerBalAmt.replace(",", "."))
      : availBalAmt
        ? Number(availBalAmt.replace(",", "."))
        : null,
    currency: getTag(body, "CURDEF"),
    transactions
  };
}
