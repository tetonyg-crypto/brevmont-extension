/**
 * Google Messages Web adapter — messages.google.com.
 *
 * The personal-text capture story. Reps handle a huge volume of
 * off-CRM texts on their personal phone; Google Messages web mirrors
 * that on desktop.
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
  surface_kind: 'sms',
  default_output: 'text',
};

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('messages.google.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function readHeaderText(): string {
  try {
    const anchor =
      (document.querySelector('mws-conversation-menu h2') as HTMLElement | null) ||
      (document.querySelector('mws-conversation-container h2') as HTMLElement | null) ||
      (document.querySelector('main h1, main h2') as HTMLElement | null);
    return (anchor?.innerText || anchor?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

function scrapeThread(): ThreadContext {
  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    // Google Messages uses Angular custom elements: mws-message-part-content
    // for individual bubbles, mws-message-wrapper for direction hints.
    const wrappers = Array.from(
      document.querySelectorAll('mws-message-wrapper, [class*="message-wrapper"], mws-message-part-content')
    ).slice(-40);
    for (const w of wrappers) {
      const text = (w as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) continue;
      const outbound = /(?:outgoing|self|sender-side)/i.test(w.className || '');
      const direction: ThreadContext['messages'][number]['direction'] = outbound ? 'outbound' : 'inbound';
      messages.push({ text: text.slice(0, 600), direction });
      if (direction === 'inbound') last_inbound_text = text.slice(0, 2000);
    }
  } catch {
    /* noop */
  }
  const raw_text = [
    readHeaderText(),
    ...messages.map((m) => `[${m.direction}] ${m.text}`),
  ].filter(Boolean).join('\n').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('gmsg'),
    raw_text,
    messages,
    last_inbound_text,
    header_text: readHeaderText(),
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  try {
    const header = readHeaderText();
    if (!header) return { name: null };
    // Google Messages shows a phone number when the contact isn't
    // saved; treat that like WhatsApp — extract to phone, not name.
    if (/^\+?\d[\d\s().-]{4,}$/.test(header)) {
      return { name: null, phone: header.replace(/[^\d+]/g, ''), raw_source: 'gmsg_phone_only', confidence: 0.6 };
    }
    if (header.length > 1 && header.length < 60) {
      return { name: header, raw_source: 'gmsg_conversation_header', confidence: 0.85 };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const body = ((document.querySelector('mws-conversation-container, main') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  // Google Messages composer — mws-message-compose renders a textarea.
  const box =
    (document.querySelector('mws-message-compose textarea') as HTMLElement | null) ||
    (document.querySelector('textarea[aria-label*="Text message" i]') as HTMLElement | null) ||
    (document.querySelector('mws-message-compose [contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('main textarea:not([readonly])') as HTMLElement | null);
  if (!box) return { ok: false, reason: 'no_gmsg_composer_found' };
  return {
    ok: true,
    method: 'gmsg_message_compose',
    composer_selector: 'mws-message-compose textarea',
  };
}

export const googleMessagesAdapter: PlatformAdapter = {
  id: 'google-messages',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
