/**
 * Instagram DM adapter — instagram.com/direct/ threads.
 *
 * The previous "generic role='main' scrape" is replaced with a
 * dedicated Instagram DOM path: thread header for the counterpart's
 * display name, aria-labelled message rows for direction, and the
 * "Message" contenteditable for inject.
 */

import type {
  AdapterCapabilities,
  CustomerCandidate,
  DealContext,
  InjectKind,
  InjectResult,
  PlatformAdapter,
  ThreadContext,
} from './types';
import { extractVehicleHint, stableKeyFromPath } from './shared';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true,
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'social_dm',
  default_output: 'text',
};

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('instagram.com/direct');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function readHeaderText(): string {
  try {
    const anchor =
      (document.querySelector('[role="main"] header h1') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header h2') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header a[role="link"]') as HTMLElement | null);
    return (anchor?.innerText || anchor?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

function scrapeThread(): ThreadContext {
  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    const main = document.querySelector('[role="main"]');
    if (main) {
      // Instagram groups messages into role="row" or [aria-label*="Message"]
      // ancestors. Iterate the direct message list children.
      const bubbles = Array.from(main.querySelectorAll(
        '[role="row"], [aria-label*="Message" i], [data-testid*="message" i]'
      )).slice(-40);
      for (const b of bubbles) {
        const text = (b as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) continue;
        // Instagram marks own bubbles with align-right styling — no
        // deterministic aria-label like "You sent" available. Best
        // heuristic: bubbles inside `[dir="rtl"]` classes are outbound.
        // Fallback: last bubble is what we probably need to reply to.
        const outboundHint = !!b.closest('[data-scope="messages"] [class*="own" i]');
        const direction: ThreadContext['messages'][number]['direction'] = outboundHint ? 'outbound' : 'inbound';
        messages.push({ text: text.slice(0, 600), direction });
        if (direction === 'inbound') last_inbound_text = text.slice(0, 2000);
      }
    }
  } catch {
    /* noop */
  }
  const raw_text = [
    readHeaderText(),
    ...messages.map((m) => `[${m.direction}] ${m.text}`),
  ].filter(Boolean).join('\n').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('ig'),
    raw_text,
    messages,
    last_inbound_text,
    header_text: readHeaderText(),
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  try {
    // Direct message header — the counterpart's display name.
    const header = readHeaderText();
    if (header && header.length > 1 && header.length < 60) {
      // Strip trailing IG-specific decorators like "· Active now"
      const cleaned = header.replace(/\s*[·•]\s*(?:Active now|typing|Online|Offline).*$/i, '').trim();
      if (cleaned && cleaned.length > 1) {
        return { name: cleaned, raw_source: 'ig_thread_header', confidence: 0.85 };
      }
    }
    // Aria-label on the thread — "Chat with <Name>" pattern
    const chatLabel = document.querySelector('[aria-label^="Chat with " i]') as HTMLElement | null;
    if (chatLabel) {
      const label = chatLabel.getAttribute('aria-label') || '';
      const m = label.match(/^Chat with\s+(.+?)(?:\s+profile)?$/i);
      if (m && m[1]) {
        return { name: m[1].trim(), raw_source: 'ig_aria_chat_with', confidence: 0.85 };
      }
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const body = ((document.querySelector('[role="main"]') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  // Instagram's compose contenteditable is aria-label="Message" (or
  // localized equivalents). Falls back to the generic textbox.
  const box =
    (document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Message" i]') as HTMLElement | null) ||
    (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('textarea[placeholder*="Message" i]') as HTMLElement | null);
  if (!box) return { ok: false, reason: 'no_ig_compose_found' };
  return {
    ok: true,
    method: 'ig_message_composer',
    composer_selector: 'div[role="textbox"][contenteditable="true"]',
  };
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
