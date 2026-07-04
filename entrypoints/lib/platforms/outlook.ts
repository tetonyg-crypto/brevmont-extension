/**
 * Outlook web adapter — outlook.live.com / outlook.office.com thread views.
 *
 * Uses conservative Microsoft web selectors plus ARIA fallbacks. If Outlook
 * changes the reading pane or compose body, detect() still succeeds but
 * scrape/inject return sparse data so the sidepanel falls back to manual input.
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
import { extractVehicleHint, findGenericComposer, stableKeyFromPath } from './shared';

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
  const u = String(url || '').toLowerCase();
  return u.includes('outlook.live.com') || u.includes('outlook.office.com') || u.includes('outlook.office365.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function readSubject(): string {
  const selectors = [
    '[role="heading"][aria-level="1"]',
    '[data-testid="message-subject"]',
    '[data-testid="conversationSubject"]',
    'div[aria-label^="Subject"]',
    'h1',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    const text = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length < 240) return text;
  }
  return '';
}

function scrapeThread(): ThreadContext {
  const messages: ThreadContext['messages'] = [];
  const subject = readSubject();
  try {
    const roots = Array.from(document.querySelectorAll(
      '[data-testid*="messageBody" i], [aria-label*="Message body" i], [role="document"], article'
    )).slice(-24);
    for (const root of roots) {
      const text = ((root as HTMLElement).innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 5) continue;
      messages.push({ text: text.slice(0, 800), direction: 'unknown' });
    }
  } catch {
    /* noop */
  }
  const pane =
    (document.querySelector('[data-app-section="ConversationReadingPane"]') as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null);
  const rawText = (pane?.innerText || document.body?.innerText || '').slice(0, 5000);
  const last = messages.length ? messages[messages.length - 1].text : rawText.slice(-2000);
  return {
    conversation_key: stableKeyFromPath('outlook'),
    raw_text: [subject, rawText].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: last,
    header_text: subject,
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  const selectors = [
    '[data-testid*="sender" i]',
    '[aria-label^="From" i]',
    '.ms-Persona-primaryText',
    '[title*="@"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
    const raw = (title || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || undefined;
    const cleaned = raw
      .replace(/^From\s*/i, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned.length > 1 && cleaned.length < 80) {
      return { name: cleaned, email, raw_source: `outlook:${sel}`, confidence: 0.78 };
    }
    if (email) {
      return { name: email.split('@')[0], email, raw_source: `outlook:${sel}:email_local`, confidence: 0.62 };
    }
  }
  return { name: null };
}

function extractContext(): DealContext {
  const subject = readSubject();
  const body = ((document.querySelector('[data-app-section="ConversationReadingPane"], [role="main"]') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(`${subject}\n${body}`);
  return {
    subject_line: subject || null,
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const body =
    (document.querySelector('[aria-label*="Message body" i][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
    findGenericComposer('email');
  if (!body) return { ok: false, reason: 'no_outlook_compose_body' };
  return {
    ok: true,
    method: 'outlook_compose_body',
    composer_selector: '[aria-label*="Message body"][contenteditable="true"]',
  };
}

export const outlookAdapter: PlatformAdapter = {
  id: 'outlook',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
