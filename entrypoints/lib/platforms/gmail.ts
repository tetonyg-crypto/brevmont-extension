/**
 * Gmail adapter — mail.google.com thread + compose surfaces.
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
  supports_inject_text: false,
  supports_inject_email: true,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'email',
  default_output: 'email',
};

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('mail.google.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function scrapeThread(): ThreadContext {
  let raw_text = '';
  let header_text = '';
  const messages: ThreadContext['messages'] = [];
  try {
    // Subject line — the topmost h2 in the thread view.
    const subject = document.querySelector('h2') as HTMLElement | null;
    if (subject) header_text = (subject.innerText || '').trim().slice(0, 200);
    // Message bodies — Gmail uses .a3s and .h7 wrappers per message.
    const msgEls = Array.from(document.querySelectorAll('.h7, [role="list"] > *, .a3s')).slice(0, 20);
    for (const el of msgEls) {
      const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 5) continue;
      messages.push({ text: text.slice(0, 800), direction: 'unknown' });
    }
    // Fallback to full-list scrape for the raw_text side.
    const list = document.querySelector('.h7, [role="list"], .a3s') as HTMLElement | null;
    raw_text = (list?.innerText || document.body?.innerText || '').slice(0, 5000);
  } catch {
    /* noop */
  }
  const inboundGuess = messages.length ? messages[messages.length - 1].text : raw_text.slice(0, 2000);
  return {
    conversation_key: stableKeyFromPath('gmail'),
    raw_text: [header_text, raw_text].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: inboundGuess,
    header_text,
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  try {
    // Gmail compose dialog — the "To" chip has a resolved contact.
    const composeRoot =
      document.querySelector('div[role="dialog"]') ||
      document.querySelector('[role="region"][aria-label*="compose" i]');
    if (composeRoot) {
      const hover = composeRoot.querySelector('[data-hovercard-id]');
      if (hover) {
        const name =
          hover.getAttribute('name') ||
          (hover as HTMLElement).textContent?.trim() ||
          null;
        if (name && !name.includes('@')) {
          return { name, raw_source: 'gmail_compose_chip', confidence: 0.9 };
        }
        const email = hover.getAttribute('data-hovercard-id') || '';
        const local = email.split('@')[0];
        if (local) return { name: local, email, raw_source: 'gmail_compose_email_local', confidence: 0.7 };
      }
      // Compose is open but To is empty — return null so we don't
      // accidentally attribute the background thread's sender.
      return { name: null };
    }
    // Thread view — the .gD element holds the sender's display name.
    const senderEl = document.querySelector('.gD') as HTMLElement | null;
    if (senderEl) {
      const name = senderEl.getAttribute('name') || senderEl.textContent?.trim() || null;
      if (name) {
        const email = senderEl.getAttribute('email') || undefined;
        return { name, email, raw_source: 'gmail_sender_gD', confidence: 0.85 };
      }
    }
    // Fallback — the .go / [data-name] pair
    const goEl = document.querySelector('.go');
    if (goEl) {
      const name = (goEl as HTMLElement).textContent?.trim() || null;
      if (name) return { name, raw_source: 'gmail_go_element', confidence: 0.65 };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const subject = (document.querySelector('h2') as HTMLElement | null)?.innerText?.trim() || null;
  const body = ((document.querySelector('.a3s, [role="list"]') as HTMLElement | null)?.innerText || '').slice(0, 3000);
  const vh = extractVehicleHint(`${subject || ''}\n${body}`);
  return {
    subject_line: subject,
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  // Gmail's compose surface differs by mode (new draft vs reply).
  // The core injectGmailEmail path handles the multi-step body-write.
  // Adapter returns the compose-body selector so the shared write
  // path can target it.
  const composeRoot =
    (document.querySelector('div[role="dialog"] div[contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('[g_editable="true"]') as HTMLElement | null);
  if (!composeRoot) return { ok: false, reason: 'no_compose_dialog_open' };
  return {
    ok: true,
    method: 'gmail_compose_body',
    composer_selector: composeRoot.tagName.toLowerCase() + '[contenteditable="true"]',
  };
}

export const gmailAdapter: PlatformAdapter = {
  id: 'gmail',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
