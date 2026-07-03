/**
 * WhatsApp Web adapter — web.whatsapp.com.
 *
 * Prior state: "manifest match and prayed" — the content script fires
 * but SCAN_LEAD falls through to gatherAllText() and extractContactName
 * has no whatsapp branch. This adapter is the real capture path.
 *
 * WhatsApp has a heavy Spanish-speaking buyer population per spec, so
 * the customer extractor is careful to strip Spanish decorators like
 * "en línea" from header labels.
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

// Presence/status decorators to strip from header labels across
// English + Spanish + Portuguese (WhatsApp UI localizes).
const PRESENCE_DECORATORS_RE =
  /\s*(?:online|typing|typing[.]{3}|last seen[^,]*|activo|activa|escribiendo|en l[ií]nea|em linha|digitando|visto por[uú]ltima vez[^,]*)\s*$/i;

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('web.whatsapp.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function readHeaderText(): string {
  try {
    const anchor =
      (document.querySelector('#main header span[title]') as HTMLElement | null) ||
      (document.querySelector('header span[dir="auto"][title]') as HTMLElement | null) ||
      (document.querySelector('header [role="button"] span[dir="auto"]') as HTMLElement | null);
    if (!anchor) return '';
    const raw = anchor.getAttribute('title') || anchor.innerText || anchor.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

function scrapeThread(): ThreadContext {
  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    const main = document.querySelector('#main');
    if (main) {
      // WhatsApp uses copyable-text containers for each message.
      const bubbles = Array.from(main.querySelectorAll(
        '.message-in .copyable-text, .message-out .copyable-text, [data-testid="msg-container"]'
      )).slice(-50);
      for (const b of bubbles) {
        const text = ((b as HTMLElement).innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) continue;
        const outbound = !!(b.closest('.message-out') || (b as HTMLElement).getAttribute('data-testid')?.includes('out'));
        const direction: ThreadContext['messages'][number]['direction'] = outbound ? 'outbound' : 'inbound';
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
    conversation_key: stableKeyFromPath('wa'),
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
    let cleaned = header.replace(PRESENCE_DECORATORS_RE, '').trim();
    // Phone-only labels shouldn't be treated as names. WhatsApp shows
    // phone numbers when the contact isn't saved; a naive "name" here
    // is a phone string like "+1 555 123 4567".
    if (/^\+?\d[\d\s().-]{4,}$/.test(cleaned)) {
      return { name: null, phone: cleaned.replace(/[^\d+]/g, ''), raw_source: 'wa_phone_only', confidence: 0.6 };
    }
    if (cleaned && cleaned.length > 1 && cleaned.length < 60) {
      return { name: cleaned, raw_source: 'wa_header_title', confidence: 0.85 };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const body = ((document.querySelector('#main') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  // WhatsApp Web's compose contenteditable is `[data-tab]` numbered.
  // The current stable selector is `div[contenteditable="true"][data-tab="10"]`,
  // with fallback to footer contenteditable.
  const box =
    (document.querySelector('div[contenteditable="true"][data-tab="10"]') as HTMLElement | null) ||
    (document.querySelector('footer div[contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') as HTMLElement | null);
  if (!box) return { ok: false, reason: 'no_wa_composer_found' };
  return {
    ok: true,
    method: 'whatsapp_footer_composer',
    composer_selector: 'div[contenteditable="true"][data-tab="10"]',
  };
}

export const whatsappAdapter: PlatformAdapter = {
  id: 'whatsapp',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
