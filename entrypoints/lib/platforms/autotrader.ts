/**
 * AutoTrader Dealer Portal adapter — INSUFFICIENT PUBLIC EVIDENCE per
 * Phase 3 research. Ships as best-effort with JSF/legacy patterns.
 *
 * Research findings:
 * - dealers.autotrader.com/dc/portal/index.jsf — JSF/JSP server-rendered
 * - Cox Automotive SSO (shares login with VinSolutions)
 * - Iframe-heavy Bridge Bar navigation
 *
 * Documented-live-spike-required for production use. Adapter provides
 * generic fallbacks so the sidebar still renders.
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
  return String(url || '').toLowerCase().includes('autotrader.com');
}
function detect(): boolean { return hostMatches(window.location.href); }

function scrapeThread(): ThreadContext {
  const raw_text = (document.body?.innerText || '').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('at'),
    raw_text, messages: [], last_inbound_text: raw_text.slice(-2000),
    header_text: (document.querySelector('h1, h2, .headerText') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  // JSF/WebForms server-emitted IDs typically follow `form:name:index` conventions.
  const jsfLabel = document.querySelector('[id*="customer"] , [id*="lead"], .customerName') as HTMLElement | null;
  const raw = (jsfLabel?.innerText || (document.querySelector('h1') as HTMLElement | null)?.innerText || '').trim();
  return raw.length > 1 && raw.length < 60
    ? { name: raw, raw_source: 'autotrader_jsf_generic', confidence: 0.4 }
    : { name: null };
}

function extractContext(): DealContext {
  const body = (document.body?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return { vehicle: vh?.raw || null, vehicle_year: vh?.year || null, vehicle_make: vh?.make || null, vehicle_model: vh?.model || null };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const box = findGenericComposer('text');
  if (!box) return { ok: false, reason: 'no_composer_found_on_autotrader' };
  return { ok: true, method: 'generic_fallback', composer_selector: 'div[role="textbox"][contenteditable="true"], textarea' };
}

export const autotraderAdapter: PlatformAdapter = { id: 'autotrader', capabilities: CAPS, hostMatches, detect, scrapeThread, extractCustomer, extractContext, inject };
