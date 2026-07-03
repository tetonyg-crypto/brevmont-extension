/**
 * Speed + safety envelope — jitter, typing simulation, active-hours
 * checks. Called by the background worker between detection and send.
 *
 * Spec targets (§v2 Phase 2):
 *   - Detection → sent under 15s
 *   - Randomized 3-10s pre-send jitter
 *   - Typing-time simulation: ~1s per 15 chars, capped at 8s
 *   - Never literally 0s every time
 */

/** Random integer inclusive of [min, max]. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sleep primitive. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compute the pre-send jitter — a random 3-10 second delay before we
 * even start typing simulation. Weighted toward 4-7s (Marketplace's
 * native auto-replies are near-instant, but reps take a beat).
 */
export function computePreSendJitterMs(): number {
  // Triangular distribution around 5.5s with min=3, max=10.
  const u1 = Math.random();
  const u2 = Math.random();
  const combined = (u1 + u2) / 2;
  return Math.max(3000, Math.min(10_000, Math.round(3000 + combined * 7000)));
}

/**
 * Simulate typing time proportional to message length. ~1s per 15
 * chars, capped at 8s. A human doesn't type at a constant rate, so
 * we add ±20% jitter.
 */
export function computeTypingMs(messageText: string): number {
  const chars = String(messageText || '').length;
  const base = Math.min(8000, Math.max(1500, Math.round((chars / 15) * 1000)));
  const jitter = 1 + (Math.random() - 0.5) * 0.4; // 0.8x - 1.2x
  return Math.round(base * jitter);
}

/**
 * Overall latency budget: jitter + typing. Returns a callable that
 * waits both intervals — the caller does inject after jitter, then
 * waits the typing period, then send.
 */
export interface SafetyDelay {
  jitter_ms: number;
  typing_ms: number;
  total_ms: number;
  waitBeforeInject(): Promise<void>;
  waitAfterInject(): Promise<void>;
}

export function buildSafetyDelay(messageText: string): SafetyDelay {
  const jitter_ms = computePreSendJitterMs();
  const typing_ms = computeTypingMs(messageText);
  return {
    jitter_ms,
    typing_ms,
    total_ms: jitter_ms + typing_ms,
    waitBeforeInject: () => sleep(jitter_ms),
    waitAfterInject: () => sleep(typing_ms),
  };
}

/**
 * Active-hours check. Spec: default 7am-10pm rep local. Inquiry stage
 * bypasses this window (first-touch speed is the pitch); deeper stages
 * queue to window open.
 */
export function inActiveHours(now: Date, start: number, end: number): boolean {
  const hour = now.getHours();
  if (start <= end) return hour >= start && hour < end;
  // Wraparound window (e.g. start=22, end=6 → overnight)
  return hour >= start || hour < end;
}

/**
 * Rep-typing standby detection. If the rep's own keydown / input event
 * fires in the composer within the last N seconds, we stand down for
 * this thread. Implemented as a rolling last-activity timestamp
 * updated by a document-level listener the caller installs.
 */
let lastRepInputAt = 0;

export function markRepInput(): void {
  lastRepInputAt = Date.now();
}

export function repRecentlyTyped(withinMs = 5000): boolean {
  return Date.now() - lastRepInputAt < withinMs;
}

/**
 * Wire up the rep-input listener on document. Idempotent.
 */
let repInputListenerInstalled = false;
export function installRepInputWatcher(): void {
  if (repInputListenerInstalled || typeof document === 'undefined') return;
  const listener = () => markRepInput();
  document.addEventListener('keydown', listener, { capture: true, passive: true });
  document.addEventListener('input', listener, { capture: true, passive: true });
  repInputListenerInstalled = true;
}
