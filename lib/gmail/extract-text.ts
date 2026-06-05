import "server-only";

// ============================================================================
// Text extraction from email attachments — PDFs (text-layer first, OCR
// fallback via Google Vision API), images (Vision OCR), plain text.
//
// All functions take a Buffer and return the extracted plain text.
// ============================================================================

// pdfjs-dist's legacy build runs in Node without Canvas. We disable workers
// because we don't need parallelism here (one PDF at a time).
async function extractPdfText(buf: Buffer): Promise<string> {
  // Dynamic import — pdfjs is heavy and not needed for non-PDFs
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Disable worker (Node has no Web Workers)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjs as any).GlobalWorkerOptions.workerSrc = "";

  // pdfjs expects Uint8Array; isEvalSupported off for security.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true
  });
  const pdf = await loadingTask.promise;
  const texts: string[] = [];
  // Cap at 5 pages — nota fiscal is rarely longer than 2
  const maxPages = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ("str" in it ? it.str : ""))
      .filter(Boolean)
      .join(" ");
    texts.push(pageText);
  }
  return texts.join("\n");
}

/** OCR a PDF page or image via Google Vision API (uses GOOGLE_GENAI_API_KEY).
 *  Returns null if Vision isn't configured. */
async function ocrViaVision(buf: Buffer, mimeType: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return null;
  // For PDFs we'd need to convert to image first; skip PDF OCR via Vision for
  // now and rely on the pdfjs text-layer extraction. Vision IS used for image
  // attachments (PNG/JPG) which often happen with WhatsApp-style invoices.
  if (mimeType.startsWith("application/pdf")) return null;

  const b64 = buf.toString("base64");
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: b64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }]
        }
      ]
    })
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
  };
  return j.responses?.[0]?.fullTextAnnotation?.text ?? null;
}

/** Top-level extraction dispatcher. Returns plain text or empty string. */
export async function extractAttachmentText(
  buf: Buffer,
  mimeType: string,
  filename?: string
): Promise<{ text: string; method: "pdf-text" | "vision-ocr" | "raw-text" | "failed" }> {
  const lcName = (filename ?? "").toLowerCase();
  const isPdf = mimeType.includes("pdf") || lcName.endsWith(".pdf");
  const isImage =
    mimeType.startsWith("image/") ||
    /\.(png|jpg|jpeg|gif|bmp|webp)$/.test(lcName);
  const isText =
    mimeType.startsWith("text/") || /\.(txt|csv|html?)$/.test(lcName);

  try {
    if (isPdf) {
      const text = await extractPdfText(buf);
      if (text.trim().length >= 20) {
        return { text, method: "pdf-text" };
      }
      // Text layer was empty — likely scanned image-PDF. Vision API can't
      // OCR PDFs directly via the REST endpoint; would need to render pages
      // to images first (not implemented here). Fall through to failed.
      return { text: "", method: "failed" };
    }
    if (isImage) {
      const ocr = await ocrViaVision(buf, mimeType);
      if (ocr && ocr.trim().length >= 20) {
        return { text: ocr, method: "vision-ocr" };
      }
      return { text: "", method: "failed" };
    }
    if (isText) {
      return { text: buf.toString("utf8"), method: "raw-text" };
    }
    return { text: "", method: "failed" };
  } catch {
    return { text: "", method: "failed" };
  }
}
