/**
 * LinkedIn adapter — DMs + profile-page context.
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

const LINKEDIN_UI_NAME_RE =
  /^(?:ad options|advertising|sponsored|promoted|grade|follow|message|connect|open to|profile|activity|about|experience|education|linkedin|notifications|jobs|home|my network|premium)$/i;

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('linkedin.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function findMessageBox(): HTMLElement | null {
  return (
    (document.querySelector('.msg-form__contenteditable[contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('[aria-label*="Write a message" i][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('.msg-form__contenteditable') as HTMLElement | null)
  );
}

function scrapeThread(): ThreadContext {
  let raw_text = '';
  let header_text = '';
  const messages: ThreadContext['messages'] = [];
  const href = String(window.location.href || '');
  const isMessaging =
    /linkedin\.com\/messaging/i.test(href)
    || !!document.querySelector('.msg-s-message-list-content, .msg-form__contenteditable, .msg-overlay-conversation-bubble');
  try {
    if (!isMessaging) {
      const nameEl = document.querySelector('main h1, .pv-text-details__left-panel h1, h1.text-heading-xlarge') as HTMLElement | null;
      const headlineEl = document.querySelector('.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium') as HTMLElement | null;
      const name = (nameEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const headline = (headlineEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      header_text = [name, headline].filter(Boolean).join(' · ');
      raw_text = header_text;
      return {
        conversation_key: stableKeyFromPath('linkedin'),
        raw_text: raw_text.slice(0, 800),
        messages: [],
        last_inbound_text: '',
        header_text,
        url: href,
      };
    }
    const thread =
      (document.querySelector('.msg-s-message-list-content') as HTMLElement | null) ||
      (document.querySelector('[class*="msg-thread"]') as HTMLElement | null) ||
      (document.querySelector('[class*="message-list"]') as HTMLElement | null) ||
      (document.querySelector('.msg-conversations-container__thread-view') as HTMLElement | null) ||
      (document.querySelector('[class*="scaffold-layout__detail"]') as HTMLElement | null);
    raw_text = (thread?.innerText || '').slice(0, 5000);
    const headerAnchor =
      document.querySelector('.msg-overlay-bubble-header__title') ||
      document.querySelector('.msg-thread__link-to-profile') ||
      document.querySelector('.msg-entity-lockup__entity-title');
    if (headerAnchor) {
      header_text = (headerAnchor as HTMLElement).innerText?.trim().slice(0, 200) || '';
    }
    const bubbles = Array.from(document.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event, [class*="msg-s-message"]')).slice(-30);
    for (const b of bubbles) {
      const t = (b as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (!t || t.length < 3) continue;
      messages.push({ text: t.slice(0, 600), direction: 'unknown' });
    }
  } catch {
    /* noop */
  }
  const inbound = messages.length ? messages[messages.length - 1].text : '';
  return {
    conversation_key: stableKeyFromPath('linkedin'),
    raw_text: [header_text, raw_text].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: inbound,
    header_text,
    url: href,
  };
}

function extractCustomer(): CustomerCandidate {
  try {
    const selectors = [
      'main h1.text-heading-xlarge',
      '.pv-text-details__left-panel h1',
      '.ph5 h1',
      'h1.text-heading-xlarge',
      '.msg-overlay-bubble-header__title',
      '.msg-s-message-group__name',
      '.msg-thread__link-to-profile',
      '.msg-entity-lockup__entity-title',
      '[data-anonymize="person-name"]',
      '[aria-label^="View "] [dir="ltr"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 2 || raw.length > 80) continue;
      if (LINKEDIN_UI_NAME_RE.test(raw)) continue;
      return { name: raw, raw_source: `linkedin_selector:${sel}`, confidence: 0.85 };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const body = ((document.querySelector('main, [role="main"]') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  if (_kind !== 'text') return { ok: false, reason: 'linkedin_only_supports_customer_message_inject' };
  const box = findMessageBox();
  if (!box) return { ok: false, reason: 'no_message_box_open' };
  return {
    ok: true,
    method: 'linkedin_msg_form',
    composer_selector: '.msg-form__contenteditable[contenteditable="true"]',
  };
}

export const linkedinAdapter: PlatformAdapter = {
  id: 'linkedin',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
