/**
 * VinSolutions adapter — CRM contact records + note-add screens +
 * legacy Cox iframe embeds.
 *
 * The strongest legacy platform: existing scanText() extracts VIN,
 * inventory, customer identity from the CRM DOM plus its nested
 * iframes. Adapter wraps that.
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
import { gatherAllText } from '../leadContextScan';

const CAPS: AdapterCapabilities = {
  supports_inject_text: false,
  supports_inject_email: false,
  supports_inject_crm_note: true,
  supports_thread_history: false,
  supports_customer_extraction: true,
  surface_kind: 'crm',
  default_output: 'crm_note',
};

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return u.includes('vinsolutions.com') || u.includes('coxautoinc.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function scrapeThread(): ThreadContext {
  const raw_text = gatherAllText().slice(0, 5000);
  return {
    conversation_key: stableKeyFromPath('vinsolutions'),
    raw_text,
    messages: [],
    last_inbound_text: '',
    header_text: (document.querySelector('h1, h2') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  // VinSolutions surfaces the customer name in several places; the
  // page's h1 or a Customer: label are the most reliable anchors.
  try {
    // 1) Explicit "Customer: <Name>" pattern
    const bodyText = document.body?.innerText || '';
    const m = bodyText.match(/Customer\s*:?\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/);
    if (m && m[1]) {
      return { name: m[1].trim(), raw_source: 'vin_customer_label', confidence: 0.9 };
    }
    // 2) Contact record H1
    const h1 = document.querySelector('h1') as HTMLElement | null;
    if (h1) {
      const raw = (h1.innerText || '').trim();
      if (/^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3}$/.test(raw) && raw.length < 60) {
        return { name: raw, raw_source: 'vin_h1', confidence: 0.75 };
      }
    }
    // 3) [data-name] anywhere
    const named = document.querySelector('[data-name]') as HTMLElement | null;
    if (named) {
      const n = named.getAttribute('data-name');
      if (n && n.length > 1 && n.length < 60) {
        return { name: n, raw_source: 'vin_data_name_attr', confidence: 0.8 };
      }
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  const raw = gatherAllText().slice(0, 5000);
  const vh = extractVehicleHint(raw);
  // Detect the CRM sub-screen: add-note vs contact-record vs other.
  let crm_context = 'VinSolutions_unknown';
  try {
    const path = window.location.pathname || '';
    if (/AddNote/i.test(path) || raw.includes('Add Note')) {
      crm_context = 'VinSolutions_AddNote';
    } else if (/Contact/i.test(path)) {
      crm_context = 'VinSolutions_ContactRecord';
    } else {
      crm_context = 'VinSolutions_' + (path.replace(/\//g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'home');
    }
  } catch { /* noop */ }
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
    crm_context,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  // VinSolutions note fields live inside CKEditor iframes on the
  // AddNote page; find the innermost editable body.
  try {
    const cke = document.querySelector('iframe.cke_wysiwyg_frame') as HTMLIFrameElement | null;
    if (cke && cke.contentDocument?.body) {
      return {
        ok: true,
        method: 'vin_cke_iframe_body',
        composer_selector: 'iframe.cke_wysiwyg_frame >>> body[contenteditable]',
      };
    }
    const noteField =
      (document.querySelector('textarea[id*="note" i]:not([readonly])') as HTMLElement | null) ||
      (document.querySelector('textarea:not([readonly])') as HTMLElement | null);
    if (noteField) {
      return {
        ok: true,
        method: 'vin_note_textarea',
        composer_selector: noteField.tagName.toLowerCase(),
      };
    }
  } catch { /* noop */ }
  return { ok: false, reason: 'no_note_field_found' };
}

export const vinsolutionsAdapter: PlatformAdapter = {
  id: 'vinsolutions',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
