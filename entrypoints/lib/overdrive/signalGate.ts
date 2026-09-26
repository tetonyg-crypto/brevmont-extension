/**
 * Overdrive signal gating — pure helpers used by backgroundController.
 *
 * Production (2026-09 audit) logged ~14,700 overdrive.send_blocked events in
 * 30 days from Facebook pages that aren't message threads (conversation keys
 * `path:/`, `path:/photo/`, empty-inbound hash 811c9dc5), the same key+hash
 * repeated up to 2,205 times. Two rules:
 *   1. Only a real thread key (`t:<id>` Messenger, `mp:<id>` Marketplace —
 *      see contentBridge.computeConversationKey) is evaluated at all.
 *   2. A blocked verdict is reported once per conversation + inbound hash
 *      (+ reason), not on every mutation that re-evaluates it.
 */

export function isOverdriveThreadKey(key: unknown): boolean {
  return /^(?:t|mp):[^\s/]+$/.test(String(key || ''));
}

export interface BlockedVerdict {
  conversation_key: string;
  inbound_hash?: string | null;
  source?: string;
  reason: string;
}

/** Returns a function that says whether this blocked verdict is new (report
 *  it) or already reported (drop it). Bounded so a long session can't grow it
 *  without limit; the oldest entries are forgotten first. */
export function createBlockedVerdictDeduper(maxEntries = 500): (verdict: BlockedVerdict) => boolean {
  const seen = new Set<string>();
  return (verdict: BlockedVerdict): boolean => {
    const key = [
      verdict.conversation_key,
      verdict.inbound_hash || 'empty',
      verdict.source || '',
      verdict.reason,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > maxEntries) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
}
