/**
 * LinkedIn adapter — DMs + profile-page context.
 *
 * Messaging scans the OPEN thread pane only. Inbox rows and Sponsored
 * Messaging ads are never used as the customer or last inbound.
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
import {
  extractLinkedInThreadCustomer,
  isLinkedInMessagingSurface,
  scrapeLinkedInOpenThread,
} from '../linkedinThread';

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

function scrapeThread(): ThreadContext {
  const href = String(window.location.href || '');
  if (!isLinkedInMessagingSurface(href) && !document.querySelector('.msg-s-message-list-content, .msg-form__contenteditable, .msg-overlay-conversation-bubble')) {
    const nameEl = document.querySelector('main h1, .pv-text-details__left-panel h1, h1.text-heading-xlarge') as HTMLElement | null;
    const headlineEl = document.querySelector('.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium') as HTMLElement | null;
    const name = (nameEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const headline = (headlineEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const header_text = [name, headline].filter(Boolean).join(' · ');
    return {
      conversation_key: stableKeyFromPath('linkedin'),
      raw_text: header_text.slice(0, 800),
      messages: [],
      last_inbound_text: '',
      header_text,
      url: href,
    };
  }
  const scraped = scrapeLinkedInOpenThread(document);
  return {
    conversation_key: stableKeyFromPath('linkedin'),
    raw_text: scraped.raw_text,
    messages: scraped.messages,
    last_inbound_text: scraped.last_inbound_text,
    header_text: scraped.header_text,
    url: href,
  };
}

function extractCustomer(): CustomerCandidate {
  const found = extractLinkedInThreadCustomer(document);
  if (!found.name) return { name: null };
  return { name: found.name, raw_source: found.raw_source, confidence: found.confidence };
}

function extractContext(): DealContext {
  const scraped = scrapeLinkedInOpenThread(document);
  const body = scraped.raw_text || scraped.header_text;
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
