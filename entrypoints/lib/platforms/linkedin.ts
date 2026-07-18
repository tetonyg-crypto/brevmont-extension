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
import { cleanCustomerNameCandidate } from '../leadContextScan';

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
  /^(?:ad options|advertising|sponsored|promoted|grade|follow|message|connect|open to|profile|activity|about|experience|education|linkedin|notifications|jobs|home|my network|premium|status is reachable|reachable|mobile|active now|online)$/i;

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

function normalizeLine(value: unknown, max = 400): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function textOf(selector: string, root: Document | Element = document): string {
  const el = root.querySelector(selector) as HTMLElement | null;
  return normalizeLine(el?.innerText || el?.textContent || '');
}

function activeThreadRoot(): HTMLElement | null {
  return (
    (document.querySelector('.msg-conversations-container__thread-view') as HTMLElement | null) ||
    (document.querySelector('.msg-s-message-list-content') as HTMLElement | null) ||
    (document.querySelector('[class*="scaffold-layout__detail"]') as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null)
  );
}

function activeThreadHeader(): string {
  const selectors = [
    '.msg-thread__link-to-profile',
    '.msg-overlay-bubble-header__title',
    '.msg-entity-lockup__entity-title',
    '.msg-s-message-group__name',
    '[data-anonymize="person-name"]',
  ];
  for (const selector of selectors) {
    const cleaned = cleanCustomerNameCandidate(textOf(selector));
    if (cleaned && !LINKEDIN_UI_NAME_RE.test(cleaned)) return cleaned.slice(0, 120);
  }
  return '';
}

function activeConversationHref(): string {
  const selectors = [
    '.msg-conversation-listitem--active a[href*="/messaging/thread"]',
    'a[aria-current="page"][href*="/messaging/thread"]',
    '.msg-thread__link-to-profile[href]',
    'a[href*="/in/"]',
  ];
  for (const selector of selectors) {
    const href = (document.querySelector(selector) as HTMLAnchorElement | null)?.href || '';
    if (href) return href;
  }
  return '';
}

function activeThreadSignature(): string {
  const root = activeThreadRoot();
  const body = normalizeLine(root?.innerText || '', 600);
  const tail = body.slice(-180);
  return [window.location.href, activeConversationHref(), activeThreadHeader(), tail].filter(Boolean).join('|');
}

function isSponsoredOrAdThread(root: HTMLElement | null): boolean {
  const activeListText = normalizeLine(
    (document.querySelector('.msg-conversation-listitem--active') as HTMLElement | null)?.innerText ||
    (document.querySelector('[aria-current="page"]') as HTMLElement | null)?.textContent ||
    ''
  );
  const header = [
    textOf('.msg-thread__link-to-profile'),
    textOf('.msg-overlay-bubble-header__title'),
    textOf('.msg-entity-lockup__entity-title'),
  ].filter(Boolean).join(' ');
  const bodyStart = normalizeLine(root?.innerText || '', 900);
  const joined = `${activeListText}\n${header}\n${bodyStart}`;
  return /\b(?:sponsored|promoted|advertisement|ad options)\b/i.test(joined) ||
    /\binmail\b/i.test(joined) && /\b(?:sponsored|promoted|ad)\b/i.test(joined);
}

function scrapeThread(): ThreadContext {
  let raw_text = '';
  let header_text = '';
  const messages: ThreadContext['messages'] = [];
  try {
    const thread = activeThreadRoot();
    if (isSponsoredOrAdThread(thread)) {
      return {
        conversation_key: `linkedin:blocked:${activeThreadSignature() || stableKeyFromPath('linkedin')}`,
        raw_text: '',
        messages: [],
        last_inbound_text: '',
        header_text: 'LinkedIn ad thread',
        blocked_reason: 'This is an ad - open a customer conversation.',
        is_blocked_context: true,
        url: window.location.href,
        scanned_at: Date.now(),
        message_count: 0,
      };
    }
    raw_text = (thread?.innerText || document.body?.innerText || '').slice(0, 5000);
    // Header — the recipient's name in the top of the thread view.
    header_text = activeThreadHeader();
    // Message bubbles — the msg-s-event-listitem class family
    const messageRoot = thread || document;
    const bubbles = Array.from(messageRoot.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event, [class*="msg-s-message"]')).slice(-30);
    for (const b of bubbles) {
      const t = normalizeLine((b as HTMLElement).innerText, 600);
      if (!t || t.length < 3) continue;
      messages.push({ text: t.slice(0, 600), direction: 'unknown' });
    }
  } catch {
    /* noop */
  }
  const inbound = messages.length ? messages[messages.length - 1].text : raw_text.slice(-2000);
  const signature = activeThreadSignature();
  return {
    conversation_key: `linkedin:${signature || stableKeyFromPath('linkedin')}`,
    raw_text: [header_text, raw_text].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: inbound,
    header_text,
    url: window.location.href,
    scanned_at: Date.now(),
    message_count: messages.length,
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
      const raw = cleanCustomerNameCandidate(el.innerText || el.textContent || '');
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
