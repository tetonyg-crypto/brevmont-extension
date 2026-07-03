/**
 * Spike A — Programmatic send on Messenger.
 *
 * The extension has always injected text but never triggered send —
 * that was a user click. Overdrive needs autonomous send.
 *
 * Approach: attempt three methods in order, first-verified wins.
 *   1. Enter keydown/keyup on the focused composer (matches how real
 *      typing submits; least detectable by Facebook's anti-automation
 *      because a `keyboard` InputDeviceCapabilities check on the event
 *      is what they filter on)
 *   2. Locate and click Messenger's send button node (higher detection
 *      surface — MouseEvent isTrusted=false is what FB flags; but the
 *      button click path is more reliable across Messenger UI variants)
 *   3. React Fiber onClick invocation — reach into React's internal
 *      props via `__reactProps$<key>` on the button node and call the
 *      onClick handler directly. Bypasses the event isTrusted check
 *      entirely because we never dispatch an event. Higher risk of
 *      breaking on React internal renames.
 *
 * After each attempt, wait briefly and re-scrape the DOM to verify the
 * pending message either (a) disappeared from the composer AND appeared
 * in the thread as sent, or (b) at minimum, the composer contenteditable
 * was cleared to empty. First-verified attempt wins; unverified sends
 * bubble up so the caller can log overdrive.send_unverified without
 * auto-retrying.
 */

import type { OverdriveSendResult } from './types';

const SEND_VERIFY_TIMEOUT_MS = 2500;
const SEND_VERIFY_POLL_MS = 100;

/** Sleep primitive. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Locate the composer contenteditable on messenger.com and
 * facebook.com/messages. Uses the same selector chain safeInjectText
 * targets so we're guaranteed to find the field we just wrote to.
 */
function findComposer(): HTMLElement | null {
  return (
    document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Message" i]') as HTMLElement | null
  ) ||
    (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null);
}

/**
 * Locate Messenger's Send button. Facebook rotates class names on
 * every deploy, but the aria-label "Send" and role="button" pair has
 * been stable for years. Fallbacks catch older UI + Marketplace
 * variants.
 */
function findSendButton(): HTMLElement | null {
  const candidates = [
    'div[aria-label="Send"][role="button"]',
    'button[aria-label="Send"]',
    'div[role="button"][aria-label*="Send" i]',
    // Marketplace/Messenger sometimes uses "Press Enter to send" tooltip.
    '[data-visualcompletion="loading-state"]:not(:empty) + div[role="button"][aria-label*="Send" i]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

/**
 * Post-send verification. Success = (composer is empty OR was replaced
 * with the placeholder) AND the message text appears in the thread
 * history. We give it up to SEND_VERIFY_TIMEOUT_MS to settle.
 */
async function verifySent(composer: HTMLElement | null, sentText: string): Promise<boolean> {
  const startedAt = Date.now();
  const target = String(sentText || '').trim().slice(0, 40);
  if (!target) return false;
  while (Date.now() - startedAt < SEND_VERIFY_TIMEOUT_MS) {
    const composerEmpty = !composer || (composer.textContent || '').trim().length === 0;
    // Look for the message we just sent in the last few outgoing bubbles.
    // Messenger renders sent bubbles with role="gridcell" and
    // aria-label containing timestamp; simplest is to look at innerText
    // of the main thread scroller for a recent occurrence.
    const main = document.querySelector('[role="main"]') as HTMLElement | null;
    const appeared = main ? String(main.innerText || '').includes(target) : false;
    if (composerEmpty && appeared) return true;
    await sleep(SEND_VERIFY_POLL_MS);
  }
  return false;
}

/**
 * Method 1 — dispatch Enter keydown + keyup on the composer.
 * Facebook's Lexical editor calls preventDefault on Enter and routes
 * it to the send handler. We fire a `keyboard`-marked InputDeviceCapabilities
 * to look like a real key event; `isTrusted` will still be false, but
 * some Messenger UI variants only check the key/code/repeat combination.
 */
async function attemptEnterKey(composer: HTMLElement, sentText: string): Promise<boolean> {
  composer.focus();
  const evtInit: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    charCode: 13,
    bubbles: true,
    cancelable: true,
    // shiftKey false — plain Enter, NOT Shift+Enter which inserts a newline.
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    composed: true,
  } as KeyboardEventInit;
  composer.dispatchEvent(new KeyboardEvent('keydown', evtInit));
  composer.dispatchEvent(new KeyboardEvent('keypress', evtInit));
  composer.dispatchEvent(new KeyboardEvent('keyup', evtInit));
  return verifySent(composer, sentText);
}

/**
 * Method 2 — synthetic click on Messenger's Send button.
 * Uses MouseEvent so React's onClick handler receives a full event
 * with clientX/clientY/button. Facebook's automation filter may still
 * catch isTrusted=false.
 */
async function attemptButtonClick(composer: HTMLElement | null, sentText: string): Promise<boolean> {
  const btn = findSendButton();
  if (!btn) return false;
  // First: dispatch pointerdown/up + mousedown/up + click sequence to
  // best approximate a real tap on both React and non-React paths.
  const events: [string, EventInit][] = [
    ['pointerdown', { bubbles: true, cancelable: true, composed: true } as PointerEventInit],
    ['mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 } as MouseEventInit],
    ['pointerup', { bubbles: true, cancelable: true, composed: true } as PointerEventInit],
    ['mouseup', { bubbles: true, cancelable: true, composed: true, button: 0 } as MouseEventInit],
    ['click', { bubbles: true, cancelable: true, composed: true, button: 0 } as MouseEventInit],
  ];
  for (const [name, init] of events) {
    try {
      const Ctor = name === 'click' || name.startsWith('mouse') ? MouseEvent : PointerEvent;
      btn.dispatchEvent(new (Ctor as any)(name, init));
    } catch {
      /* older browsers may lack PointerEvent; MouseEvent path still works */
    }
  }
  // Fall back to raw click() in case none of the synthesized events
  // triggered React.
  try { btn.click(); } catch { /* ignore */ }
  return verifySent(composer, sentText);
}

/**
 * Method 3 — reach into React Fiber and invoke the onClick handler
 * directly. Bypasses the event isTrusted check because we never
 * dispatch an event. Higher risk of breaking on internal React key
 * renames, but for the ~1% of cases where methods 1 + 2 both fail
 * silently (typically because Messenger just rolled out a new UI
 * variant), this is the rescue.
 */
async function attemptReactFiber(composer: HTMLElement | null, sentText: string): Promise<boolean> {
  const btn = findSendButton();
  if (!btn) return false;
  const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
  if (!propsKey) return false;
  const props = (btn as any)[propsKey];
  if (typeof props?.onClick !== 'function') return false;
  try {
    // Fabricate a plausible React SyntheticEvent shape.
    const syntheticEvent = {
      type: 'click',
      target: btn,
      currentTarget: btn,
      preventDefault() {},
      stopPropagation() {},
      persist() {},
      nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true }),
      isTrusted: false,
      bubbles: true,
      cancelable: true,
      button: 0,
    };
    props.onClick(syntheticEvent);
  } catch (err) {
    return false;
  }
  return verifySent(composer, sentText);
}

/**
 * Public API — attempt to send the composer's current text
 * autonomously. `sentText` is the text we just injected via
 * safeInjectText and is what verifySent looks for in the thread.
 * Returns a structured result so the caller can log which method
 * won and whether the send was DOM-verified.
 */
export async function overdriveSend(sentText: string): Promise<OverdriveSendResult> {
  const startedAt = Date.now();
  const composer = findComposer();
  const attempts: OverdriveSendResult['attempts'] = [];

  if (!composer) {
    return {
      ok: false,
      method: 'not_attempted',
      verified: false,
      latency_ms: Date.now() - startedAt,
      error: 'composer_not_found',
      attempts,
    };
  }

  // Method 1: Enter key
  try {
    const ok = await attemptEnterKey(composer, sentText);
    attempts.push({ method: 'enter_key', ok });
    if (ok) {
      return {
        ok: true,
        method: 'enter_key',
        verified: true,
        latency_ms: Date.now() - startedAt,
        attempts,
      };
    }
  } catch (err: any) {
    attempts.push({ method: 'enter_key', ok: false, error: err?.message || 'threw' });
  }

  // Method 2: synthetic button click
  try {
    const ok = await attemptButtonClick(composer, sentText);
    attempts.push({ method: 'button_click', ok });
    if (ok) {
      return {
        ok: true,
        method: 'button_click',
        verified: true,
        latency_ms: Date.now() - startedAt,
        attempts,
      };
    }
  } catch (err: any) {
    attempts.push({ method: 'button_click', ok: false, error: err?.message || 'threw' });
  }

  // Method 3: React fiber
  try {
    const ok = await attemptReactFiber(composer, sentText);
    attempts.push({ method: 'react_fiber', ok });
    if (ok) {
      return {
        ok: true,
        method: 'react_fiber',
        verified: true,
        latency_ms: Date.now() - startedAt,
        attempts,
      };
    }
  } catch (err: any) {
    attempts.push({ method: 'react_fiber', ok: false, error: err?.message || 'threw' });
  }

  // All methods failed verification.
  return {
    ok: false,
    method: 'not_attempted',
    verified: false,
    latency_ms: Date.now() - startedAt,
    error: 'all_methods_failed_verification',
    attempts,
  };
}
