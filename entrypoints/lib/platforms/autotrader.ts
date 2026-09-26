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

/**
 * The adapter's host match also covers public listing pages, where the
 * page tail is not a customer message and the H1 is the listing title,
 * not a customer. Customer + last inbound are only read on dealer
 * inbox/lead hosts. (Host list from docs; dealer markup is unverified.)
 */
function isDealerSurface(): boolean {
  let host = '';
  try { host = new URL(window.location.href).hostname.toLowerCase(); } catch { return false; }
  return /^(?:dealers?|partners?)\.autotrader\.com$/.test(host);
}

function scrapeThread(): ThreadContext {
  const raw_text = (document.body?.innerText || '').slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('at'),
    raw_text, messages: [], last_inbound_text: isDealerSurface() ? raw_text.slice(-2000) : '',
    header_text: (document.querySelector('h1, h2, .headerText') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  if (!isDealerSurface()) return { name: null };
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
