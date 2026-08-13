/**
 * Which paths each role is allowed to REACH. Pure string predicates, split out
 * of middleware.ts so they can be tested — a routing rule that silently sends
 * the wrong role somewhere else is invisible until a real person clicks a
 * button and nothing happens, which is exactly how the secretary lost the
 * "Abrir PDF da nota" button.
 *
 * These decide ROUTING only. Every handler still enforces its own role check;
 * nothing here grants access to data.
 */

/** Open to everyone — login, logout, the webhook, the cron, the secretary link. */
export function isAlwaysOpen(pathname: string): boolean {
  if (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname === "/api/household/login" ||
    pathname === "/api/household/logout" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout"
  ) return true;
  return (
    pathname.startsWith("/api/pluggy/webhook") ||
    pathname.startsWith("/api/cron/") ||
    // Secretary sign-in link. The route itself validates the token in constant
    // time and 404s on anything else — it must reach the handler rather than be
    // bounced to /login, which is the whole point of a password-free link.
    pathname.startsWith("/celina/")
  );
}

/**
 * The invoice PDF is the one artefact the health roles must reach that does not
 * live under /api/admin/health. The handler enforces the role itself and hides
 * non-medical invoices from the secretary.
 */
const INVOICE_PDF = /^\/api\/admin\/nota-fiscais\/[^/]+\/pdf$/;

/** Reachable by admin, health (Ayelet) and secretary (Celina). */
export function isHealthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin/health") ||
    pathname.startsWith("/api/admin/health") ||
    INVOICE_PDF.test(pathname)
  );
}

/** Admin-only territory (unless it is also a health path, checked first). */
export function isAdminGated(pathname: string): boolean {
  return pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}
