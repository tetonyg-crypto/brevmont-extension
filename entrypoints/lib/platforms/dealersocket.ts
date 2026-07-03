/**
 * DealerSocket CRM (SocketTalk) adapter — FEASIBLE per Phase 3 research.
 *
 * Research findings: the Dealer Funnel Chrome extension (listed in CWS)
 * explicitly injects into DealerSocket to detect names/phones and
 * overlay comms. That proves content-script access works in production.
 *
 * SocketTalk uses legacy Angular / ASP.NET patterns.
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
  return String(url || '').toLowerCase().includes('dealersocket.com');
}
function detect(): boolean { return hostMatches(window.location.href); }

function scrapeThread(): ThreadContext {
  const list = (document.querySelector('.messageList, [ng-repeat*="message"], .conversation-thread') as HTMLElement | null);
  const raw_text = (list?.innerText || document.body?.innerText || '').slice(0, 5000);
  const messages: ThreadContext['messages'] = [];
  try {
    const rows = Array.from(document.querySelectorAll('.messageRow, [ng-repeat*="message"] > *')).slice(-30);
    for (const r of rows) {
      const t = (r as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (t && t.length > 2) messages.push({ text: t.slice(0, 500), direction: 'unknown' });
    }
  } catch { /* noop */ }
  return {
    conversation_key: stableKeyFromPath('ds'),
    raw_text, messages,
    last_inbound_text: messages.length ? messages[messages.length - 1].text : raw_text.slice(-2000),
    header_text: (document.querySelector('.lead-header .name, .customerName, h1') as HTMLElement | null)?.innerText?.trim() || '',
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  // Legacy Angular / ASP.NET patterns per Dealer Funnel's public description.
  const anchors = [
    '.customerName',
    '.lead-header .name',
    '[ng-bind*="Customer"]',
    '[ng-bind*="Lead"]',
    '#customerName',
  ];
  for (const sel of anchors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.length > 1 && raw.length < 60) {
      return { name: raw, raw_source: `dealersocket:${sel}`, confidence: 0.7 };
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
    crm_context: 'DealerSocket',
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const box =
    (document.querySelector('textarea#SocketTalkMessage') as HTMLElement | null) ||
    (document.querySelector('textarea[ng-model*="messageText"]') as HTMLElement | null) ||
    (document.querySelector('textarea[ng-model*="note"]') as HTMLElement | null) ||
    findGenericComposer('crm_note');
  if (!box) return { ok: false, reason: 'no_dealersocket_composer' };
  return {
    ok: true,
    method: 'dealersocket_sockettalk',
    composer_selector: box.tagName.toLowerCase() + (box.id ? `#${box.id}` : ''),
  };
}

export const dealersocketAdapter: PlatformAdapter = { id: 'dealersocket', capabilities: CAPS, hostMatches, detect, scrapeThread, extractCustomer, extractContext, inject };
