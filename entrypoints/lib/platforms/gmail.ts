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

type GmailDirection = ThreadContext['messages'][number]['direction'];

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('mail.google.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function normalizeEmail(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function collectLoggedInEmails(): Set<string> {
  const emails = new Set<string>();
  try {
    const selectors = [
      'a[aria-label*="Google Account" i]',
      'a[aria-label*="Google account" i]',
      'img[alt*="Google Account" i]',
      'img[alt*="Google account" i]',
    ];
    for (const el of Array.from(document.querySelectorAll(selectors.join(',')))) {
      const element = el as HTMLElement;
      for (const value of [
        element.getAttribute('aria-label'),
        element.getAttribute('alt'),
        element.getAttribute('data-email'),
        element.getAttribute('email'),
        element.textContent,
      ]) {
        const email = normalizeEmail(value);
        if (email) emails.add(email);
      }
    }
  } catch {
    /* noop */
  }
  return emails;
}

function cleanMessageText(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const removeSelectors = [
    '.gmail_quote',
    'blockquote',
    '.yj6qo',
    '.adL',
    '.im',
    '.ii.gt + .yj6qo',
    '[aria-label*="Show trimmed content" i]',
    '[aria-label*="Hide expanded content" i]',
  ];
  for (const el of Array.from(clone.querySelectorAll(removeSelectors.join(',')))) {
    el.remove();
  }
  return (clone.innerText || clone.textContent || '')
    .replace(/\bOn .+ wrote:\s*$/i, '')
    .replace(/[-_]{2,}\s*Forwarded message\s*[-_]{2,}[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const el of elements) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}

function messageRoots(): Element[] {
  const roots = Array.from(document.querySelectorAll('.adn, .h7')).filter((el) => {
    const body = el.querySelector('.a3s, [role="textbox"], [dir="ltr"], [dir="auto"]');
    const sender = el.querySelector('.gD[email], .gD[name], .go[email], [email]');
    return Boolean(body && sender);
  });
  if (roots.length) {
    const seenBodies = new Set<Element>();
    return uniqueElements(roots).filter((root) => {
      const body = root.querySelector('.a3s, [role="textbox"], [dir="ltr"], [dir="auto"]') || root;
      if (seenBodies.has(body)) return false;
      seenBodies.add(body);
      return true;
    });
  }

  return uniqueElements(
    Array.from(document.querySelectorAll('.a3s')).map((body) => {
      const root = body.closest('.adn, .h7, [role="listitem"], [role="article"]');
      return root || body;
    }),
  );
}

function senderForMessage(root: Element): { email: string; name: string; isMeMarker: boolean } {
  const sender =
    root.querySelector('.gD[email], .gD[name], .go[email], .gD, .go, [email]') as HTMLElement | null;
  const email = normalizeEmail(
    sender?.getAttribute('email') ||
    sender?.getAttribute('data-hovercard-id') ||
    sender?.getAttribute('aria-label') ||
    sender?.textContent ||
    '',
  );
  const name = String(sender?.getAttribute('name') || sender?.textContent || '').trim();
  const marker = name.toLowerCase().replace(/\s+/g, ' ');
  return { email, name, isMeMarker: marker === 'me' || marker === 'you' };
}

function directionForMessage(
  root: Element,
  loggedInEmails: Set<string>,
): { direction: GmailDirection; reason: string } {
  const sender = senderForMessage(root);
  if (sender.isMeMarker) {
    return { direction: 'outbound', reason: 'gmail_me_sender_marker' };
  }
  if (loggedInEmails.size === 0) {
    return { direction: 'unknown', reason: 'missing_logged_in_account_identity' };
  }
  if (sender.email && loggedInEmails.has(sender.email)) {
    return { direction: 'outbound', reason: 'sender_email_matches_logged_in_account' };
  }
  if (sender.email && !loggedInEmails.has(sender.email)) {
    return { direction: 'inbound', reason: 'sender_email_differs_from_logged_in_account' };
  }
  return { direction: 'unknown', reason: 'missing_sender_identity' };
}

function scrapeThread(): ThreadContext {
  let raw_text = '';
  let header_text = '';
  const messages: ThreadContext['messages'] = [];
  try {
    // Subject line — the topmost h2 in the thread view.
    const subject = document.querySelector('h2') as HTMLElement | null;
    if (subject) header_text = (subject.innerText || '').trim().slice(0, 200);
    const loggedInEmails = collectLoggedInEmails();
    for (const el of messageRoots().slice(-30)) {
      const { direction } = directionForMessage(el, loggedInEmails);
      if (direction === 'unknown') continue;
      const body = el.querySelector('.a3s') || el;
      const text = cleanMessageText(body);
      if (!text || text.length < 5) continue;
      messages.push({ text: text.slice(0, 800), direction });
    }
    raw_text = messages.map((message) => `[${message.direction}] ${message.text}`).join('\n').slice(0, 5000);
  } catch {
    /* noop */
  }
  const lastInbound = messages.slice().reverse().find((message) => message.direction === 'inbound')?.text || '';
  return {
    conversation_key: stableKeyFromPath('gmail'),
    raw_text: [header_text, raw_text].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: lastInbound,
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
