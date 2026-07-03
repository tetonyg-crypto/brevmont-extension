/**
 * Cars.com Commerce Hub / Dealer Inspire Conversations adapter — MAYBE per Phase 3 research.
 *
 * Research findings (universal-capture-phase0-2026-07-02.md § Phase 3):
 * Cars.com consolidated dealer bookmarks into a Commerce Hub. Actual
 * messaging surface is Dealer Inspire "Conversations", which is a
 * React widget embedded (possibly cross-origin iframe) inside the
 * dealer dashboard.
 *
 * Manifest hosts shipped: cars.com, dealerinspire.com, carscommerce.inc.
 * Adapter uses generic React-chat conventions until we have a live
 * dealer spike.
 */

import type {
  AdapterCapabilities, CustomerCandidate, DealContext,
  InjectKind, InjectResult, PlatformAdapter, ThreadContext,
} from './types';
import { extractVehicleHint, findGenericComposer, stableKeyFromPath } from './shared';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true, supports_inject_email: false, supports_inject_crm_note: false,
  supports_thread_history: true, supports_customer_extraction: true,
  surface_kind: 'marketplace_inbox', default_output: 'text',
};

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return u.includes('cars.com') || u.includes('dealerinspire.com') || u.includes('carscommerce.inc');
}
function detect(): boolean { return hostMatches(window.location.href); }

function scrapeThread(): ThreadContext {
  const list = document.querySelector('[class*="ConversationList"], [class*="messages"], [data-testid*="conversation"]') as HTMLElement | null;
  const raw_text = (list?.innerText || document.body?.innerText || '').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('cars'),
    raw_text, messages: [], last_inbound_text: raw_text.slice(-2000),
    header_text: (document.querySelector('h1, h2') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  const header = document.querySelector('[class*="ConversationHeader"] [class*="name"], [data-testid*="customer-name"]') as HTMLElement | null;
  const raw = (header?.innerText || (document.querySelector('h1') as HTMLElement | null)?.innerText || '').trim();
  return raw.length > 1 && raw.length < 60
    ? { name: raw, raw_source: 'carsdotcom_react_header', confidence: 0.5 }
    : { name: null };
}

function extractContext(): DealContext {
  const body = (document.body?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return { vehicle: vh?.raw || null, vehicle_year: vh?.year || null, vehicle_make: vh?.make || null, vehicle_model: vh?.model || null };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const box = (document.querySelector('[data-testid="message-input"] textarea, [data-testid*="message-input"]') as HTMLElement | null) || findGenericComposer('text');
  if (!box) return { ok: false, reason: 'no_composer_found_on_cars' };
  return { ok: true, method: 'carsdotcom_react_composer', composer_selector: '[data-testid="message-input"] textarea' };
}

export const carsdotcomAdapter: PlatformAdapter = { id: 'carsdotcom', capabilities: CAPS, hostMatches, detect, scrapeThread, extractCustomer, extractContext, inject };
