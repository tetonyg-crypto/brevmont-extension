/**
 * Pinned-customer carryover across a thread switch — pure decision used by
 * the side panel (entrypoints/sidepanel/main.ts).
 *
 * The side panel pins a customer per conversation. On Facebook, Instagram,
 * WhatsApp, X and Google Messages the pin's identity check is by NAME, and a
 * not-yet-readable name used to keep the pin. Combined with thread switches
 * only being noticed by a 3-second poll, Generate right after switching sent
 * the PREVIOUS customer. Rule: once the conversation key differs from the one
 * the pin was made on, keep the pin only when the new thread's name is read
 * AND matches. Unreadable means drop it — never guess.
 */

export interface PinCarryoverInput {
  /** Conversation key the pin was made on (empty when unknown). */
  pinThreadKey?: string | null;
  /** Conversation key open right now (empty when unknown). */
  currentThreadKey?: string | null;
  pinName?: string | null;
  /** Customer name read from the thread open now ('' when unreadable). */
  currentName?: string | null;
}

function comparable(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the pinned customer must be dropped for the thread open now. */
export function shouldDropCarriedOverPin(input: PinCarryoverInput): boolean {
  const pinKey = String(input.pinThreadKey || '');
  const liveKey = String(input.currentThreadKey || '');
  // No thread signal on one side: nothing to compare (name checks still run
  // elsewhere).
  if (!pinKey || !liveKey) return false;
  if (pinKey === liveKey) return false;
  const pinName = comparable(input.pinName);
  const liveName = comparable(input.currentName);
  if (pinName && liveName && pinName === liveName) return false;
  return true;
}

/**
 * True when the tab's platform itself changed since the last poll tick
 * (Instagram -> WhatsApp, etc). The side panel's poller (startCustomerDetection
 * in sidepanel/main.ts) otherwise only compares SAME-platform signals — a
 * WhatsApp conversation_key against the last WhatsApp conversation_key, or a
 * URL path/hash against the last URL on the same platform — and both go
 * quiet across a platform boundary: the WhatsApp check requires a
 * previously-seen WhatsApp key, which is empty on first arrival from
 * another platform; the URL check runs only when the platform is not
 * WhatsApp. Either way a stale pin's own name-match check then silently
 * passes because the new platform hasn't read a name yet.
 *
 * Confirmed live 2026-09-26: an Instagram lead (cardogvlogs) survived a
 * switch to WhatsApp because nothing ever independently asked "is this even
 * the same platform the pin was made on." This check must run unconditionally,
 * before and independent of the per-platform comparisons, and must not be
 * overwritten back to false by them.
 */
export function didPlatformChange(previousPlatform: string, currentPlatform: string): boolean {
  const prev = String(previousPlatform || '');
  const now = String(currentPlatform || '');
  return prev !== now;
}
