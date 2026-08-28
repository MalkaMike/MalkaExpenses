// ============================================================================
// Deep link to a Gmail message, in the RIGHT mailbox.
//
// The old form — /mail/u/0/#inbox/<id> — hardcodes the browser's FIRST
// signed-in account. That was fine while the search read one mailbox. With a
// second `receipts` connection, a receipt found there would open a link
// pointing at the wrong account and render "message not found".
//
// `authuser=<email>` asks Gmail for that specific account regardless of
// sign-in order. Rows stored before source_email existed pass undefined and
// keep the old behaviour, which was correct for them.
// ============================================================================

export function gmailMessageUrl(messageId: string, sourceEmail?: string | null): string {
  if (!sourceEmail) return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(sourceEmail)}#inbox/${messageId}`;
}
