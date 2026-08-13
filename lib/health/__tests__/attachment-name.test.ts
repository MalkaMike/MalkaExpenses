import { describe, it, expect } from "vitest";
import { safeName, freeName } from "../attachment-name";

describe("safeName", () => {
  it("strips any path so a file cannot escape its claim folder", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("C:\\Users\\x\\laudo.pdf")).toBe("laudo.pdf");
    expect(safeName("pasta/laudo.pdf")).toBe("laudo.pdf");
  });

  it("keeps the name readable", () => {
    expect(safeName("Laudo Dr. Katz.pdf")).toBe("Laudo_Dr._Katz.pdf");
    expect(safeName("nota fiscal — 2438.pdf")).toBe("nota_fiscal_2438.pdf");
  });

  it("never returns an empty name", () => {
    expect(safeName("")).toBe("documento");
    expect(safeName("///")).toBe("documento");
  });
});

describe("freeName", () => {
  it("keeps the name when nothing collides", () => {
    expect(freeName("laudo.pdf", [])).toBe("laudo.pdf");
    expect(freeName("laudo.pdf", ["outro.pdf"])).toBe("laudo.pdf");
  });

  // The data-loss bug: scanners return "documento.pdf" every time, and the old
  // upload overwrote the previous document silently.
  it("never reuses a taken name", () => {
    expect(freeName("documento.pdf", ["documento.pdf"])).toBe("documento-2.pdf");
    expect(freeName("documento.pdf", ["documento.pdf", "documento-2.pdf"])).toBe("documento-3.pdf");
  });

  it("compares case-insensitively, because two names that differ only in case are indistinguishable to a human", () => {
    expect(freeName("Laudo.pdf", ["laudo.pdf"])).toBe("Laudo-2.pdf");
  });

  it("puts the suffix before the extension, not after", () => {
    expect(freeName("recibo.jpeg", ["recibo.jpeg"])).toBe("recibo-2.jpeg");
    expect(freeName("scan.tar.gz", ["scan.tar.gz"])).toBe("scan.tar-2.gz");
  });

  it("handles a name with no extension", () => {
    expect(freeName("documento", ["documento"])).toBe("documento-2");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(freeName(".laudo", [".laudo"])).toBe(".laudo-2");
  });
});
