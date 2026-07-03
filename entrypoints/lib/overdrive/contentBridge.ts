/**
 * Overdrive content-script bridge — the handlers that live inside
 * the Facebook/Messenger content script and answer background
 * requests.
 *
 * Message types:
 *   OVERDRIVE_INSTALL_DETECTOR    → arm the detector layers, forward
 *                                    signals to the background
 *   OVERDRIVE_SCRAPE_THREAD       → return a ThreadScrape for the
 *                                    active thread
 *   OVERDRIVE_INJECT_TEXT         → call safeInjectText via the
 *                                    existing content-script surface
 */

import { install as installDetector, isInstalled } from './overdriveDetector';
import type { DetectionSignal } from './types';
import { installRepInputWatcher, markRepInput } from './safetyEnvelope';
import type { ThreadScrape } from './orchestrator';

let detectorForwardingSet = false;

function computeConversationKey(): string {
  // Prefer the Marketplace/Messenger thread URL segment — stable across
  // page reloads for the same conversation. Falls back to hashing the
  // thread header text so a friend DM still gets a unique key.
  try {
    const path = window.location.pathname;
    // Marketplace threads: /marketplace/t/<id>
    const mp = path.match(/\/marketplace\/t\/([^/?#]+)/);
    if (mp) return `mp:${mp[1]}`;
    // messenger.com threads: /t/<id>
    const t = path.match(/\/t\/([^/?#]+)/);
    if (t) return `t:${t[1]}`;
    return `path:${path}`;
  } catch {
    return `unknown:${Date.now()}`;
  }
}

function readThreadHeaderText(): string {
  try {
    const anchor =
      document.querySelector('[role="main"] h1') ||
      document.querySelector('[role="main"] h2') ||
      document.querySelector('[role="main"] header');
    return (anchor as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 200) || '';
  } catch {
    return '';
  }
}

function readRecentMessages(): { history: string[]; lastInbound: string } {
  // Best-effort: iterate the message list bubbles inside [role="main"].
  // We rely on the ordering — outbound bubbles have role="row" with an
  // aria-label containing "You sent" or class markers; inbound don't.
  // Facebook rotates class names, so we prefer role + aria-label.
  const history: string[] = [];
  let lastInbound = '';
  try {
    const main = document.querySelector('[role="main"]');
    if (!main) return { history: [], lastInbound: '' };
    // Grab role="row" bubbles OR generic message containers.
    const candidates = Array.from(
      main.querySelectorAll('[role="row"], [data-scope="messages_table"]')
    ).slice(-30);
    for (const c of candidates) {
      const text = (c as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) continue;
      history.push(text.slice(0, 500));
      // Naive inbound detection: outbound rows usually have "You sent"
      // in an aria-label somewhere in the subtree.
      const outboundHint = !!c.querySelector('[aria-label*="You sent" i]');
      if (!outboundHint) lastInbound = text.slice(0, 2000);
    }
  } catch { /* noop */ }
  return { history: history.slice(-15), lastInbound };
}

async function sha256Hex(input: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Extension may run in a sandbox where subtle is unavailable — fall
    // back to a non-cryptographic 32-bit hash. Idempotency still holds
    // as long as the mapping is deterministic per input.
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `weak-${(h >>> 0).toString(16)}`;
  }
}

function detectRepCurrentlyTyping(): boolean {
  try {
    const composer =
      (document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Message" i]') as HTMLElement | null) ||
      (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null);
    if (!composer) return false;
    const text = (composer.textContent || '').trim();
    return text.length > 0;
  } catch {
    return false;
  }
}

export async function scrapeActiveThread(): Promise<ThreadScrape> {
  const header = readThreadHeaderText();
  const url = window.location.href;
  const { history, lastInbound } = readRecentMessages();
  const conversation_key = computeConversationKey();
  const last_inbound_hash = await sha256Hex(lastInbound || `${conversation_key}::empty`);
  const rep_currently_typing = detectRepCurrentlyTyping();
  return {
    conversation_key,
    header_text: header,
    url,
    recent_messages: history,
    last_inbound_text: lastInbound,
    last_inbound_hash,
    rep_currently_typing,
    existing_stamp: null,
  };
}

/**
 * Called from content.ts's message handler once per
 * OVERDRIVE_INSTALL_DETECTOR request. Idempotent.
 */
export function armDetectorForwarding(): { ok: boolean; already?: boolean } {
  if (isInstalled() && detectorForwardingSet) return { ok: true, already: true };
  installRepInputWatcher();
  installDetector((signal: DetectionSignal) => {
    try {
      chrome.runtime.sendMessage({ type: 'OVERDRIVE_DETECTION_SIGNAL', signal }, () => {
        if (chrome.runtime.lastError) {
          /* background may be sleeping — the keepalive alarm will
             re-arm on the next tick */
        }
      });
    } catch { /* noop */ }
  });
  detectorForwardingSet = true;
  return { ok: true, already: false };
}

/**
 * Text-inject bridge. Takes a plain string, calls the safeInjectText
 * path already living in content.ts. The caller (background
 * controller) uses the return value to decide whether to advance the
 * pipeline to send.
 *
 * `safeInject` is passed in as a dependency because it's a closure
 * inside content.ts and not exportable.
 */
export function markRepTyping(): void {
  markRepInput();
}
