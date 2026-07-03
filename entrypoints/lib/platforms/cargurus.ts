/**
 * CarGurus dealer inbox adapter — STUB / DOCUMENTED-INFEASIBLE.
 *
 * Public DOM investigation (Phase 3 discovery): the CarGurus dealer
 * inbox lives behind dealer.cargurus.com and requires SSO. No public
 * documentation surfaces the DOM anatomy, and no public GitHub
 * extension targets it. The manifest match is shipped so the content
 * script fires the moment a rep opens the surface, but the scrape /
 * inject paths default to a generic fallback that logs the DOM
 * fingerprint. That fingerprint is what we use to author the real
 * adapter once we have a live dealer session.
 *
 * See: brevmont-vault/audits/universal-capture-final-2026-07-02.md
 * (§ "Dealer inbox spike plan").
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
  supports_inject_text: true,     // generic contenteditable fallback
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'marketplace_inbox',
  default_output: 'text',
};

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('cargurus.com');
}
function detect(): boolean {
  return hostMatches(window.location.href);
}

function scrapeThread(): ThreadContext {
  const raw_text = (document.body?.innerText || '').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('cg'),
    raw_text,
    messages: [],
    last_inbound_text: raw_text.slice(-2000),
    header_text: (document.querySelector('h1, h2') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  const h1 = (document.querySelector('h1') as HTMLElement | null)?.innerText?.trim() || '';
  return h1.length > 1 && h1.length < 60
    ? { name: h1, raw_source: 'cargurus_h1_generic', confidence: 0.4 }
    : { name: null };
}

function extractContext(): DealContext {
  const body = (document.body?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const box = findGenericComposer('text');
  if (!box) return { ok: false, reason: 'no_composer_found_on_cargurus' };
  return { ok: true, method: 'generic_fallback', composer_selector: 'div[role="textbox"][contenteditable="true"]' };
}

export const cargurusAdapter: PlatformAdapter = {
  id: 'cargurus',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
