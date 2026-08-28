import { describe, it, expect } from "vitest";
import { gmailMessageUrl } from "../message-url";

describe("gmailMessageUrl", () => {
  // Rows found before 0043 have no source mailbox; the old link was correct
  // for them because there was only ever one connected account.
  it("falls back to the u/0 form when the mailbox is unknown", () => {
    expect(gmailMessageUrl("abc123")).toBe("https://mail.google.com/mail/u/0/#inbox/abc123");
    expect(gmailMessageUrl("abc123", null)).toBe("https://mail.google.com/mail/u/0/#inbox/abc123");
  });

  // The whole point of the second mailbox: a receipt found in the personal
  // account must not open a link pointing at the work account.
  it("targets the exact mailbox when known", () => {
    expect(gmailMessageUrl("abc123", "someone@gmail.com")).toBe(
      "https://mail.google.com/mail/u/?authuser=someone%40gmail.com#inbox/abc123"
    );
  });

  it("escapes the address rather than splicing it in raw", () => {
    expect(gmailMessageUrl("id", "a+b@gmail.com")).toContain("authuser=a%2Bb%40gmail.com");
  });
});
