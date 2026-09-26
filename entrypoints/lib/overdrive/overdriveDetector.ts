/**
 * Spike C — Background detection for new Messenger inbounds.
 *
 * The extension currently only scans on-demand when the rep clicks
 * Scan / Generate. Overdrive needs continuous detection so a new
 * customer inquiry fires an autonomous reply within 15 seconds even
 * when the Messenger tab is backgrounded.
 *
 * Three detection layers, all free (no polling, no server dependency):
 *
 *   1. MutationObserver on the conversation list — Facebook re-orders
 *      threads when a new inbound arrives (moves the thread to the
 *      top) and often stamps an "unread" data attribute.
 *
 *   2. MutationObserver on the active thread's message list — new
 *      inbound bubbles append at the bottom of the messages container
 *      inside `[role="main"]`.
 *
 *   3. document.title observer — Facebook writes "(N) Messenger" or
 *      "(N) Facebook" into the tab title when unread messages exist.
 *      This survives the tab being backgrounded and is the ONLY
 *      layer that fires when the extension's content script sleeps
 *      because the tab was discarded. The service worker wakes it
 *      via chrome.alarms.
 *
 * Each detected signal is passed to a single callback with a stable
 * DetectionSignal shape. The caller decides what to do (usually:
 * scrape → qualify → generate → send).
 *
 * All observers are idempotent — calling install() twice is a no-op.
 * uninstall() cleans everything up.
 */

import type { DetectionCallback, DetectionSignal } from './types';

interface DetectorState {
  installed: boolean;
  callback: DetectionCallback | null;
  observers: MutationObserver[];
  titleTimer: number | null;
  mainWatchTimer: number | null;
  activeThreadTimer: number | null;
  activeThreadObserver: MutationObserver | null;
  lastTitle: string;
  lastActiveThreadContainer: Element | null;
  lastThreadKey: string | null;
  lastThreadUnread: boolean;
  /** Open thread's last-inbound signature when it was opened (see
   *  noteOpenThreadBaseline). null hash = not read yet. */
  baselineKey: string | null;
  baselineHash: string | null;
  baselineSince: number;
}

/** Reads the open thread's last-inbound signature ('' when none). Set by the
 *  content bridge; without it the title watcher can't tell whether the OPEN
 *  thread got the new message, so it never claims a new inbound. */
let readInboundSignature: (() => string) | null = null;
export function setInboundSignatureReader(fn: (() => string) | null): void {
  readInboundSignature = fn;
}

/** An empty open thread is committed as the baseline after this long, so a
 *  first-ever customer message still counts as new. */
const EMPTY_BASELINE_COMMIT_MS = 3000;

// Recency window for auto-arm (20 minutes)
const OVERDRIVE_AUTO_ARM_TTL_MS = 20 * 60 * 1000;

const state: DetectorState = {
  installed: false,
  callback: null,
  observers: [],
  titleTimer: null,
  mainWatchTimer: null,
  activeThreadTimer: null,
  activeThreadObserver: null,
  lastTitle: '',
  lastActiveThreadContainer: null,
  lastThreadKey: null,
  lastThreadUnread: false,
  baselineKey: null,
  baselineHash: null,
  baselineSince: 0,
};

/**
 * Compute the conversation key for the current thread.
 * Mirrors the logic in contentBridge.ts.
 */
function computeThreadKey(): string | null {
  try {
    const path = window.location.pathname;
    const mp = path.match(/\/marketplace\/t\/([^/?#]+)/);
    if (mp) return `mp:${mp[1]}`;
    const t = path.match(/\/t\/([^/?#]+)/);
    if (t) return `t:${t[1]}`;
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if the current thread has an unread indicator.
 * Facebook marks threads with various attributes when they have unread messages.
 */
function isThreadUnread(): boolean {
  try {
    // Check for unread badge or indicator in the thread header
    const unreadBadge = document.querySelector('[role="main"] [aria-label*="unread" i], [role="main"] [data-testid*="unread" i]');
    if (unreadBadge) return true;
    // Check for blue dot or similar indicators
    const blueDot = document.querySelector('[role="main"] [data-testid*="blue" i], [role="main"] .__fb-light-blue');
    if (blueDot) return true;
    return false;
  } catch {
    return false;
  }
}

function safeReadInboundSignature(): string {
  try {
    return readInboundSignature ? String(readInboundSignature() || '') : '';
  } catch {
    return '';
  }
}

/**
 * Remember the open thread's last inbound as of when it was opened. Runs on
 * the watchdog tick. Re-reads until the thread has painted (non-empty), and
 * commits an empty baseline once the thread has been open a few seconds.
 */
function noteOpenThreadBaseline(now = Date.now()): void {
  const key = computeThreadKey();
  if (key !== state.baselineKey) {
    state.baselineKey = key;
    state.baselineHash = null;
    state.baselineSince = now;
  }
  if (!key || state.baselineHash !== null) return;
  const sig = safeReadInboundSignature();
  if (sig) state.baselineHash = sig;
  else if (now - state.baselineSince >= EMPTY_BASELINE_COMMIT_MS) state.baselineHash = '';
}

/**
 * Does the OPEN thread have an inbound it didn't have when it was opened?
 * The tab-title count rises when ANY chat gets a message; only a change in
 * the open thread's own last inbound may let the title watcher auto-fire a
 * reply there. Unsure (no reader, thread not read yet) → false.
 */
function openThreadHasNewInbound(): boolean {
  noteOpenThreadBaseline();
  if (!readInboundSignature || state.baselineKey === null || state.baselineHash === null) return false;
  const sig = safeReadInboundSignature();
  if (!sig || sig === state.baselineHash) return false;
  state.baselineHash = sig;
  return true;
}

/** Emit through the registered callback, tolerating callback throws.
 *  Pages that aren't a message thread (feed, /photo/, profile) have nothing
 *  to reply to — signals from them used to reach the pipeline and log a
 *  blocked verdict on every mutation. */
function emit(signal: DetectionSignal): void {
  if (!computeThreadKey()) return;
  try {
    state.callback?.(signal);
  } catch {
    /* callback errors are the caller's problem, not ours */
  }
}

/**
 * Layer 1 — conversation list observer.
 * Watches for childList changes on the left-hand thread list. Facebook
 * uses `[aria-label="Chats"]` for the list and puts threads inside
 * `[role="row"]` or similar. We watch the closest stable ancestor
 * (`[role="navigation"][aria-label*="Chats" i]`) and any nav-region
 * fallback.
 */
function installConversationListObserver(): MutationObserver | null {
  const listAnchor =
    document.querySelector('[role="navigation"][aria-label*="Chats" i]') ||
    document.querySelector('[aria-label="Chats"]') ||
    document.querySelector('[data-testid="mwthreadlist"]');
  if (!listAnchor) return null;

  const obs = new MutationObserver((mutations) => {
    let noteworthy = false;
    for (const m of mutations) {
      if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
        noteworthy = true;
        break;
      }
      // Attribute mutations on threads sometimes fire on
      // unread → read transitions or thread reorders.
      if (m.type === 'attributes' && (m.attributeName === 'data-visualcompletion' || m.attributeName === 'aria-selected')) {
        noteworthy = true;
        break;
      }
    }
    if (!noteworthy) return;
    emit({
      type: 'mutation_conversation_list',
      detected_at: Date.now(),
      conversation_hint: undefined,
    });
  });

  obs.observe(listAnchor, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'data-visualcompletion'] });
  return obs;
}

/**
 * Layer 2 — active thread message list observer.
 * The active thread messages live under `[role="main"]` inside a
 * scrollable region. New inbounds are appended to the bottom. We
 * observe the [role="main"] subtree because Messenger swaps the
 * inner scroller when the thread changes.
 *
 * Trigger origin logic:
 * - If thread has unread indicator → unread_or_new_inbound (auto-fire allowed)
 * - If thread was already read → thread_open_or_focus (auto-fire blocked)
 */
function installActiveThreadObserver(): MutationObserver | null {
  const main = document.querySelector('[role="main"]');
  if (!main) return null;
  state.lastActiveThreadContainer = main;

  // Track the current thread key and unread state
  const currentKey = computeThreadKey();
  const currentUnread = isThreadUnread();
  if (currentKey) {
    state.lastThreadKey = currentKey;
    state.lastThreadUnread = currentUnread;
  }

  const queueSignal = () => {
    if (state.activeThreadTimer !== null) {
      clearTimeout(state.activeThreadTimer);
    }
    state.activeThreadTimer = window.setTimeout(() => {
      state.activeThreadTimer = null;
      // Determine trigger origin based on current thread state
      const threadKey = computeThreadKey();
      const threadUnread = isThreadUnread();
      const triggerOrigin = threadUnread ? 'unread_or_new_inbound' : 'thread_open_or_focus';
      emit({
        type: 'mutation_active_thread',
        detected_at: Date.now(),
        trigger_origin: triggerOrigin,
      });
    }, 150);
  };

  const obs = new MutationObserver((mutations) => {
    let noteworthy = false;
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        noteworthy = true;
        break;
      }
      if (m.type === 'characterData') {
        noteworthy = true;
        break;
      }
      if (m.type === 'attributes') {
        noteworthy = true;
        break;
      }
    }
    if (!noteworthy) return;
    queueSignal();
  });

  obs.observe(main, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-visualcompletion', 'data-testid', 'class'],
  });
  state.activeThreadObserver = obs;
  return obs;
}

function replaceActiveThreadObserver(): void {
  const main = document.querySelector('[role="main"]');
  if (!main || main === state.lastActiveThreadContainer) return;
  if (state.activeThreadObserver) {
    try { state.activeThreadObserver.disconnect(); } catch { /* noop */ }
    state.observers = state.observers.filter((obs) => obs !== state.activeThreadObserver);
    state.activeThreadObserver = null;
  }
  const next = installActiveThreadObserver();
  if (next) {
    state.observers.push(next);
    emit({
      type: 'mutation_active_thread',
      detected_at: Date.now(),
      conversation_hint: 'active_thread_rearmed',
    });
  }
}

/**
 * Layer 3 — document.title polling.
 * Facebook writes the unread count into the tab title. This layer
 * fires even when the tab is not focused; the visibility API can't
 * see it and MutationObserver on <head> is unreliable across UAs.
 * We poll title on a 1s interval — cheap, no observer overhead.
 *
 * The unread count covers EVERY chat, so trigger_origin is
 * 'unread_or_new_inbound' only when the open thread's own last inbound
 * changed since it was opened; otherwise 'thread_open_or_focus'.
 */
function installTitleObserver(): void {
  if (state.titleTimer !== null) return;
  state.lastTitle = document.title;
  state.titleTimer = window.setInterval(() => {
    const current = document.title;
    if (current === state.lastTitle) return;
    state.lastTitle = current;
    // Detect "(N) …" leading pattern with N >= 1
    const match = current.match(/^\s*\((\d+)\)/);
    if (match && Number(match[1]) > 0) {
      emit({
        type: 'title_unread_count',
        detected_at: Date.now(),
        raw: current,
        // The count covers every chat. Only a new inbound in the open thread
        // may auto-fire a reply there.
        trigger_origin: openThreadHasNewInbound() ? 'unread_or_new_inbound' : 'thread_open_or_focus',
      });
    }
  }, 1000);
}

function installMainWatchdog(): void {
  if (state.mainWatchTimer !== null) return;
  state.mainWatchTimer = window.setInterval(() => {
    replaceActiveThreadObserver();
    noteOpenThreadBaseline();
  }, 750);
}

function uninstallTitleObserver(): void {
  if (state.titleTimer !== null) {
    clearInterval(state.titleTimer);
    state.titleTimer = null;
  }
}

function uninstallMainWatchdog(): void {
  if (state.mainWatchTimer !== null) {
    clearInterval(state.mainWatchTimer);
    state.mainWatchTimer = null;
  }
}

/**
 * Layer 4 — chrome.alarms keepalive.
 * Called from the background service worker on a periodic alarm. If
 * observers were lost due to SW restart or tab reload, this rearms
 * them. We just re-run install() — it's idempotent on the observer
 * side, and the tab keeps its previous observers if they're still
 * attached.
 */
export function overdriveDetectorAlarmTick(): void {
  if (!state.callback) return;
  replaceActiveThreadObserver();
  // Emit an alarm signal so the caller can do a light re-scan even
  // if the observers didn't fire.
  emit({
    type: 'alarm_keepalive',
    detected_at: Date.now(),
  });
  // Rearm any observers that lost their anchor.
  const stillActive = state.observers.every((obs) => obs != null);
  if (!stillActive) {
    // Reinstall from scratch.
    uninstall();
    install(state.callback);
  }
}

/**
 * Install all three detection layers with the given callback. Idempotent.
 */
export function install(callback: DetectionCallback): void {
  if (state.installed) {
    state.callback = callback;
    return;
  }
  state.callback = callback;
  state.observers = [];

  const listObs = installConversationListObserver();
  if (listObs) state.observers.push(listObs);

  const threadObs = installActiveThreadObserver();
  if (threadObs) state.observers.push(threadObs);

  noteOpenThreadBaseline();
  installTitleObserver();
  installMainWatchdog();
  state.installed = true;
}

/**
 * Tear down all observers + timers.
 */
export function uninstall(): void {
  for (const obs of state.observers) {
    try { obs.disconnect(); } catch { /* noop */ }
  }
  state.observers = [];
  if (state.activeThreadTimer !== null) {
    clearTimeout(state.activeThreadTimer);
    state.activeThreadTimer = null;
  }
  state.activeThreadObserver = null;
  state.lastActiveThreadContainer = null;
  uninstallTitleObserver();
  uninstallMainWatchdog();
  state.baselineKey = null;
  state.baselineHash = null;
  state.installed = false;
  state.callback = null;
}

/** For tests + debugging. */
export function isInstalled(): boolean {
  return state.installed;
}
