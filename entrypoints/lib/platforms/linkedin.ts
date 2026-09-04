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
import { deepVisibleText, extractLinkedInPersonName, extractLinkedInPersonNameFromText, isChannelOrUiName, isLinkedInSelfOrCompanyLabel, isLinkedInUiChromeText, linkedInBubbleLooksOutbound, linkedInMessageLooksOutbound, linkedInThreadRoot } from '../leadContextScan';

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

function isLinkedInChromeLine(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (isLinkedInUiChromeText(t)) return true;
  return /^(?:sponsored messaging ad|get started|learn more|not interested)$/i.test(t)
    || /^you(?:'|’)re receiving this (?:ad|inmail|message) because/i.test(t)
    || isChannelOrUiName(t);
}

function stripLinkedInChrome(text: string): string {
  return String(text || '')
    .replace(/sponsored messaging ad/ig, ' ')
    .replace(/you(?:'|’)re receiving this (?:ad|inmail|message) because[^.!?\n]{0,240}[.!?]?/ig, ' ')
    .replace(/\b(?:get started|learn more|not interested)\b/ig, ' ')
    .replace(/\breact with\b[\s\S]*$/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLinkedInMessageChrome(text: string, personName?: string | null): string {
  let t = stripLinkedInChrome(text);
  t = t.replace(/\bview\s+[^.]{1,48}\s+profile\b/ig, ' ');
  t = t.replace(/\((?:he|she|they)\/(?:him|her|them)\)/ig, ' ');
  t = t.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/ig, ' ');
  if (personName) {
    const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(?:^|\\s)${escaped}\\b`, 'ig'), ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
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
      const name = extractLinkedInPersonName() || '';
      if (!name) {
        return {
          conversation_key: stableKeyFromPath('linkedin'),
          raw_text: '',
          messages: [],
          last_inbound_text: '',
          header_text: '',
          url: href,
        };
      }
      const headlineEl = document.querySelector('.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium') as HTMLElement | null;
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
    const threadRoot = linkedInThreadRoot();
    const list =
      (threadRoot?.querySelector('.msg-s-message-list-content') as HTMLElement | null) ||
      (document.querySelector('.msg-s-message-list-content') as HTMLElement | null);
    const thread = list || threadRoot || (document.querySelector('.scaffold-layout__detail, [role="main"]') as HTMLElement | null);
    raw_text = deepVisibleText(thread, 5000);
    const headerAnchor = threadRoot?.querySelector(
      '.msg-overlay-bubble-header__title, .msg-thread__link-to-profile, .msg-entity-lockup__entity-title, .msg-conversation-card__participant-names',
    ) as HTMLElement | null;
    if (headerAnchor) {
      const rawHeader = headerAnchor.innerText?.trim().slice(0, 200) || '';
      header_text = isLinkedInChromeLine(rawHeader) || isLinkedInSelfOrCompanyLabel(rawHeader) ? '' : rawHeader.split('\n')[0].trim();
    }
    if (!header_text) header_text = extractLinkedInPersonName() || extractLinkedInPersonNameFromText(raw_text) || '';
    const bubbleRoot = list || threadRoot;
    const bubbles = bubbleRoot
      ? Array.from(bubbleRoot.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event')).slice(-30)
      : [];
    for (const b of bubbles) {
      const t = stripLinkedInChrome((b as HTMLElement).innerText || '');
      if (!t || t.length < 3 || isLinkedInChromeLine(t)) continue;
      const outbound = linkedInBubbleLooksOutbound(b as HTMLElement, t, header_text);
      messages.push({
        text: t.slice(0, 600),
        direction: outbound ? 'outbound' : 'inbound',
      });
    }
    if (!messages.length && raw_text) {
      const usable = stripLinkedInChrome(raw_text)
        .split(/\n+/)
        .map((line) => stripLinkedInChrome(line))
        .filter((line) => line.length > 12 && !isLinkedInChromeLine(line));
      if (usable.length) {
        const last = usable[usable.length - 1];
        messages.push({
          text: last.slice(0, 600),
          direction: linkedInMessageLooksOutbound(last, header_text) ? 'outbound' : 'unknown',
        });
      }
    }
  } catch {
    /* noop */
  }
  const person = header_text || extractLinkedInPersonName() || extractLinkedInPersonNameFromText(raw_text) || '';
  if (!header_text) header_text = person;
  const inboundRaw = messages.slice().reverse().find((message) => {
    if (isLinkedInChromeLine(message.text)) return false;
    if (message.direction === 'outbound' || linkedInMessageLooksOutbound(message.text, person)) return false;
    return true;
  })?.text || '';
  const inbound = stripLinkedInMessageChrome(inboundRaw, person);
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
  const name = extractLinkedInPersonName()
    || extractLinkedInPersonNameFromText(deepVisibleText(linkedInThreadRoot() || document.querySelector('[role="main"]'), 2500));
  if (!name) return { name: null };
  return { name, raw_source: 'linkedin_person', confidence: 0.88 };
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
