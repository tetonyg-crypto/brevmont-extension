/**
 * Speed + safety envelope — jitter and typing simulation. Called by
 * the background worker between detection and send.
 *
 * Spec targets:
 *   - Detection → sent quickly enough that reps can see Overdrive work.
 *   - Small non-zero jitter so the pipeline never fires at literal 0ms.
 *   - Keep the delay short to avoid MV3 worker teardown between
 *     reply generation and DOM send.
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
  // Triangular distribution around 1.5s with min=0.8s, max=2.2s.
  const u1 = Math.random();
  const u2 = Math.random();
  const combined = (u1 + u2) / 2;
  return Math.max(800, Math.min(2200, Math.round(800 + combined * 1400)));
}

/**
 * Simulate typing time proportional to message length. ~1s per 15
 * chars, capped at 8s. A human doesn't type at a constant rate, so
 * we add ±20% jitter.
 */
export function computeTypingMs(messageText: string): number {
  const chars = String(messageText || '').length;
  const base = Math.min(1800, Math.max(400, Math.round((chars / 80) * 1000)));
  const jitter = 1 + (Math.random() - 0.5) * 0.3; // 0.85x - 1.15x
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

export function buildSafetyDelay(
  messageText: string,
  overrides?: { jitter_ms?: number; typing_ms?: number },
): SafetyDelay {
  const jitter_ms = Number.isFinite(overrides?.jitter_ms)
    ? Math.max(0, Math.round(Number(overrides?.jitter_ms)))
    : computePreSendJitterMs();
  const typing_ms = computeTypingMs(messageText);
  const finalTypingMs = Number.isFinite(overrides?.typing_ms)
    ? Math.max(0, Math.round(Number(overrides?.typing_ms)))
    : typing_ms;
  return {
    jitter_ms,
    typing_ms: finalTypingMs,
    total_ms: jitter_ms + finalTypingMs,
    waitBeforeInject: () => sleep(jitter_ms),
    waitAfterInject: () => sleep(finalTypingMs),
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
 *
 * SCOPE FIXES (1.16.53):
 *   1. Only mark rep input when the event target is the composer
 *      element itself or a descendant of it, not the whole document.
 *      A keystroke anywhere on the Facebook shell used to stand us
 *      down. Now we require target.closest composer match.
 *   2. Only mark rep input when event.isTrusted === true. Our own
 *      safeInjectText and overdriveSend synthetic events have
 *      isTrusted=false. The self-inflicted stand-down was caused
 *      by the injector's own dispatched events flipping the rolling
 *      timestamp forward. Filtering isTrusted stops it cold.
 */
let lastRepInputAt = 0;
const COMPOSER_SELECTOR = 'div[role="textbox"][contenteditable="true"]';

/**
 * Belt-and-suspenders (1.16.53): explicit inject-in-flight flag the
 * rep-input listener checks BEFORE isTrusted. Wrap any code path that
 * dispatches synthetic input/keydown events with withInjectInFlight()
 * — the flag is set for the wrapped scope and any microtask that
 * follows, then cleared. Guarantees markRepInput cannot fire from our
 * own inject even if a synthetic event somehow arrives with
 * isTrusted=true.
 */
let injectInFlight = false;

export function withInjectInFlight<T>(fn: () => T): T {
  injectInFlight = true;
  try {
    return fn();
  } finally {
    // Clear on the next microtask so any input/keydown events queued
    // synchronously from the wrapped block are still filtered.
    queueMicrotask(() => { injectInFlight = false; });
  }
}

export function isInjectInFlight(): boolean {
  return injectInFlight;
}

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
  const listener = (event: Event) => {
    // Belt-and-suspenders: if our own inject is dispatching right now,
    // ignore. This is the guaranteed fallback for the edge case where
    // a synthetic event arrives with isTrusted=true.
    if (injectInFlight) return;
    // Scope fix 2: ignore synthetic events fired by our own
    // safeInjectText / overdriveSend paths. Only real user input has
    // isTrusted === true.
    if (!event.isTrusted) return;
    // Scope fix 1: only fire when the target is the composer or a
    // descendant of it. A keystroke in the search bar, a sidebar,
    // or anywhere else on the shell must not stand down Overdrive.
    const target = event.target as Element | null;
    if (!target || typeof (target as any).closest !== 'function') return;
    if (!target.closest(COMPOSER_SELECTOR)) return;
    markRepInput();
  };
  document.addEventListener('keydown', listener, { capture: true, passive: true });
  document.addEventListener('input', listener, { capture: true, passive: true });
  repInputListenerInstalled = true;
}
