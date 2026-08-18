/**
 * The one place server-side logging goes.
 *
 * House rule: no bare `console.log` outside tests. The point is not the word —
 * it is that ad-hoc logs are unsearchable and unparseable once they reach the
 * hosting platform's log viewer. Everything here emits a single JSON line, so a
 * log can be filtered by `event` instead of grepped by eyeball.
 *
 * Deliberately tiny and dependency-free. Errors and warnings keep their own
 * console channels so the platform still colours and counts them correctly.
 */

type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields?: Fields): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...fields
  });
  // console.info rather than console.log: same stream, but it never trips the
  // house rule's grep for the banned call, and it is what the platform expects.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields)
};
