/**
 * Elead CRM (CDK) adapter — FEASIBLE per Phase 3 research.
 *
 * Research findings: same Dealer Funnel extension names Eleads as
 * supported. Elead UI is a legacy ASP.NET WebForms application with
 * server-emitted `ctl00_MainContent_*` IDs.
 *
 * Handles both elead-crm.com and eleadcrm.com TLDs.
 */

import type {
  AdapterCapabilities, CustomerCandidate, DealContext,
  InjectKind, InjectResult, PlatformAdapter, ThreadContext,
} from './types';
import { extractVehicleHint, findGenericComposer, stableKeyFromPath } from './shared';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true, supports_inject_email: false, supports_inject_crm_note: true,
  supports_thread_history: true, supports_customer_extraction: true,
  surface_kind: 'crm', default_output: 'crm_note',
};

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return u.includes('elead-crm.com') || u.includes('eleadcrm.com');
}
function detect(): boolean { return hostMatches(window.location.href); }

function scrapeThread(): ThreadContext {
  // WebForms grids are typically <table> with server-emitted IDs
  const grid = (document.querySelector('#ctl00_MainContent_gvMessages, table.messages-grid, [id$="gvMessages"]') as HTMLElement | null);
  const raw_text = (grid?.innerText || document.body?.innerText || '').slice(0, 5000);
  const messages: ThreadContext['messages'] = [];
  try {
    const rows = Array.from(document.querySelectorAll('[id$="gvMessages"] tr, table.messages-grid tr')).slice(-30);
    for (const r of rows) {
      const t = (r as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (t && t.length > 2) messages.push({ text: t.slice(0, 500), direction: 'unknown' });
    }
  } catch { /* noop */ }
  return {
    conversation_key: stableKeyFromPath('el'),
    raw_text, messages,
    last_inbound_text: messages.length ? messages[messages.length - 1].text : raw_text.slice(-2000),
    header_text: (document.querySelector('[id$="lblCustomerName"], .customer-info .name, h1') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  const anchors = [
    '[id$="lblCustomerName"]',
    '.customer-info .name',
    '.customerName',
    '#ctl00_MainContent_lblCustomerName',
  ];
  for (const sel of anchors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.length > 1 && raw.length < 60) {
      return { name: raw, raw_source: `elead:${sel}`, confidence: 0.7 };
    }
  }
  return { name: null };
}

function extractContext(): DealContext {
  const body = (document.body?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null, vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null, vehicle_model: vh?.model || null,
    crm_context: 'Elead',
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const box =
    (document.querySelector('textarea[id$="txtMessage"]') as HTMLElement | null) ||
    (document.querySelector('textarea[id$="txtReply"]') as HTMLElement | null) ||
    (document.querySelector('#ctl00_MainContent_txtReply, #ctl00_MainContent_txtMessage') as HTMLElement | null) ||
    findGenericComposer('crm_note');
  if (!box) return { ok: false, reason: 'no_elead_composer' };
  return {
    ok: true,
    method: 'elead_webforms',
    composer_selector: box.tagName.toLowerCase() + (box.id ? `#${box.id}` : ''),
  };
}

export const eleadAdapter: PlatformAdapter = { id: 'elead', capabilities: CAPS, hostMatches, detect, scrapeThread, extractCustomer, extractContext, inject };
