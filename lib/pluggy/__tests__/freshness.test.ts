import { describe, it, expect, vi, afterEach } from "vitest";
import { checkIngestFreshness, freshnessAlertHtml, STALE_AFTER_DAYS } from "../freshness";

/**
 * Minimal stand-in for the supabase query chain used by checkIngestFreshness:
 * .from().select().eq().order().limit().maybeSingle()
 */
function sbReturning(result: { data?: { created_at: string } | null; error?: { message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null })
  };
  return { from: () => chain } as never;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

afterEach(() => vi.useRealTimers());

describe("checkIngestFreshness", () => {
  it("reports fresh when a row landed today", async () => {
    const f = await checkIngestFreshness(sbReturning({ data: { created_at: daysAgo(0) } }));
    expect(f.isStale).toBe(false);
    expect(f.daysStale).toBe(0);
  });

  it("is still fresh one day short of the threshold", async () => {
    const f = await checkIngestFreshness(sbReturning({ data: { created_at: daysAgo(STALE_AFTER_DAYS - 1) } }));
    expect(f.isStale).toBe(false);
  });

  it("goes stale exactly at the threshold", async () => {
    const f = await checkIngestFreshness(sbReturning({ data: { created_at: daysAgo(STALE_AFTER_DAYS) } }));
    expect(f.isStale).toBe(true);
    expect(f.daysStale).toBe(STALE_AFTER_DAYS);
  });

  it("catches the real Aug-2026 outage shape (10 weeks quiet)", async () => {
    const f = await checkIngestFreshness(sbReturning({ data: { created_at: daysAgo(70) } }));
    expect(f.isStale).toBe(true);
    expect(f.daysStale).toBe(70);
  });

  it("treats a failed check as stale, not as healthy", async () => {
    const f = await checkIngestFreshness(sbReturning({ error: { message: "connection refused" } }));
    expect(f.isStale).toBe(true);
    expect(f.error).toBe("connection refused");
  });

  it("treats never-ingested as stale", async () => {
    const f = await checkIngestFreshness(sbReturning({ data: null }));
    expect(f.isStale).toBe(true);
    expect(f.lastIngestAt).toBeNull();
  });

  it("honours a custom threshold", async () => {
    const sb = sbReturning({ data: { created_at: daysAgo(5) } });
    expect((await checkIngestFreshness(sb, 10)).isStale).toBe(false);
    expect((await checkIngestFreshness(sb, 4)).isStale).toBe(true);
  });
});

describe("freshnessAlertHtml", () => {
  it("says plainly when the sync ran clean but brought nothing", () => {
    const html = freshnessAlertHtml({ lastIngestAt: daysAgo(70), daysStale: 70, isStale: true }, []);
    expect(html).toContain("rodando e voltando vazio");
  });

  it("lists sync errors when there are any", () => {
    const html = freshnessAlertHtml(
      { lastIngestAt: daysAgo(4), daysStale: 4, isStale: true },
      ["batch insert failed (Nubank): timeout"]
    );
    expect(html).toContain("batch insert failed");
  });

  it("escapes angle brackets so an error string cannot inject markup", () => {
    const html = freshnessAlertHtml(
      { lastIngestAt: daysAgo(4), daysStale: 4, isStale: true },
      ["<script>alert(1)</script>"]
    );
    expect(html).not.toContain("<script>");
  });

  it("surfaces a failed check instead of hiding it", () => {
    const html = freshnessAlertHtml(
      { lastIngestAt: null, daysStale: null, isStale: true, error: "permission denied" },
      []
    );
    expect(html).toContain("permission denied");
    expect(html).toContain("nunca");
  });
});
