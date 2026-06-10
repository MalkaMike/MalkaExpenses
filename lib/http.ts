// ============================================================================
// safeJson — the ONE sanctioned place where a JSON body-parse failure is
// swallowed. House rule bans silent `.catch(() => {})`; this helper exists so
// the exception lives in exactly one audited spot instead of 50 call sites.
//
// Why swallowing is correct HERE and only here: an unparseable/empty body on
// a request or error-response path carries no actionable information, and
// every caller validates the result immediately afterwards (Zod safeParse on
// API routes, explicit field checks in client components). Returning {} keeps
// those validations as the single source of truth.
// ============================================================================

// Default shape covers the dominant caller pattern: `j.error ?? "fallback"`.
type JsonBody = { error?: string; [key: string]: unknown };

export async function safeJson<T = JsonBody>(
  src: Request | Response
): Promise<Partial<T>> {
  try {
    return (await src.json()) as T;
  } catch {
    return {};
  }
}
