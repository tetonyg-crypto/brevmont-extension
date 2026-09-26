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
