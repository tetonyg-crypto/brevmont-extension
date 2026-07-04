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

type MessageDirection = 'inbound' | 'outbound' | 'unknown';

function collectAriaText(root: Element): string {
  const labels: string[] = [];
  const own = root.getAttribute('aria-label');
  if (own) labels.push(own);
  root.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label');
    if (label) labels.push(label);
  });
  return labels.join(' ');
}

function isColorLight(value: string): boolean {
  const m = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return false;
  const [, r, g, b] = m.map(Number);
  return r >= 225 && g >= 225 && b >= 225;
}

function isColorDarkBubble(value: string): boolean {
  const m = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?/i);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] == null ? 1 : Number(m[4]);
  if (a < 0.4) return false;
  // Outbound Messenger bubbles are usually blue/purple with white text.
  // Inbound bubbles are light gray with dark text. Avoid exact brand
  // colors because Facebook rotates themes.
  return (r + g + b) / 3 < 190;
}

function visualDirection(row: Element, main: Element): MessageDirection {
  try {
    const mainRect = (main as HTMLElement).getBoundingClientRect();
    const rowRect = (row as HTMLElement).getBoundingClientRect();
    const rowCenter = rowRect.left + rowRect.width / 2;
    const rightSide = rowCenter > mainRect.left + mainRect.width * 0.56;
    const leftSide = rowCenter < mainRect.left + mainRect.width * 0.44;
    const styled = Array.from(row.querySelectorAll('div, span')).slice(0, 80) as HTMLElement[];
    const outboundColor = styled.some((el) => {
      const s = window.getComputedStyle(el);
      return isColorLight(s.color) && isColorDarkBubble(s.backgroundColor);
    });
    if (outboundColor && rightSide) return 'outbound';
    if (leftSide && !outboundColor) return 'inbound';
  } catch { /* geometry can fail in detached nodes */ }
  return 'unknown';
}

function determineMessageDirection(row: Element, main: Element): MessageDirection {
  const aria = collectAriaText(row);
  if (/\b(?:you sent|sent by you|you replied|you:|outgoing|message sent)\b/i.test(aria)) return 'outbound';
  if (/\b(?:sent by|profile picture of|from)\b/i.test(aria) && !/\byou\b/i.test(aria)) return 'inbound';
  return visualDirection(row, main);
}

function cleanMessageText(value: string): string {
  return String(value || '')
    .replace(/\b(?:message sent|delivered|seen|read|sending)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMessengerSystemCardText(value: string): boolean {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/^you can now rate each other\b/i.test(text)) return true;
  if (/\bpeople may rate one another based on their interactions or transactions\b/i.test(text)) return true;
  if (/\brate\s+[^.]{1,80}$/i.test(text) && /\bpeople may rate one another\b/i.test(text)) return true;
  if (/^(?:marketplace|sold\s*[-–]|see details|more options)$/i.test(text)) return true;
  return false;
}

function readRecentMessages(): { history: string[]; lastInbound: string } {
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
      const text = cleanMessageText((c as HTMLElement).innerText || '');
      if (!text || text.length < 2) continue;
      if (isMessengerSystemCardText(text)) continue;
      const direction = determineMessageDirection(c, main);
      if (direction === 'unknown') continue;
      const labelled = `${direction === 'outbound' ? 'Rep' : 'Customer'}: ${text.slice(0, 460)}`;
      history.push(labelled);
      if (direction === 'inbound') lastInbound = text.slice(0, 2000);
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
