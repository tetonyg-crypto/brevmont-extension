/**
 * Content script — data conduit + text injection only (no pill/sidebar UI).
 * Generation UI lives in the Chrome Side Panel.
 */

import { dlog } from './lib/dev';
import {
  deepTableVehicleSearch,
  gatherAllText,
  getDashboardScopedText,
  scanVinText,
  safeInjectText,
  extractContactName,
  extractVehicle,
} from './lib/leadContextScan';
import type { LeadScanResult } from './lib/leadContextScan';

type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

export default defineContentScript({
  matches: [
    '*://*.vinsolutions.com/*',
    '*://vinsolutions.app.coxautoinc.com/*',
    '*://mail.google.com/*',
    '*://www.facebook.com/messages/*',
    '*://www.facebook.com/marketplace/t/*',
    '*://www.messenger.com/*',
    '*://www.linkedin.com/*',
    '*://www.instagram.com/direct/*',
    '*://www.instagram.com/direct/t/*',
    '*://web.whatsapp.com/*',
  ],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    const killed = await browser.storage.local.get(['brevmont_killed']);
    if (killed.brevmont_killed) return;

    const _url = window.location.href;
    const PLATFORM: Platform =
      _url.includes('vinsolutions') || _url.includes('coxautoinc')
        ? 'vinsolutions'
        : _url.includes('mail.google.com')
          ? 'gmail'
          : _url.includes('messenger.com') ||
              _url.includes('facebook.com/messages') ||
              _url.includes('facebook.com/marketplace/t/')
            ? 'facebook'
            : _url.includes('facebook.com')
              ? 'unknown'
              : _url.includes('linkedin.com')
                ? 'linkedin'
                : _url.includes('instagram.com/direct')
                  ? 'instagram'
                  : _url.includes('instagram.com')
                    ? 'unknown'
                    : _url.includes('web.whatsapp.com')
                      ? 'whatsapp'
                      : 'unknown';

    if (PLATFORM === 'unknown') return;

    const isVinSolutions = PLATFORM === 'vinsolutions';
    const isGmail = PLATFORM === 'gmail';

    async function forwardContext(payload: Record<string, unknown>) {
      const enriched = { ...payload, platform: PLATFORM, url: window.location.href };
      browser.runtime.sendMessage({ type: 'CUSTOMER_CONTEXT', payload: enriched }).catch(() => {});
      try {
        await browser.storage.session.set({ brevmont_customer_context: enriched });
      } catch {
        /* session storage unavailable */
      }
    }

    function getCrmPageContextForMessage(): string {
      try {
        const path = window.location.pathname || '';
        if (PLATFORM === 'vinsolutions') {
          if (/AddNote/i.test(path) || (document.body?.innerText || '').includes('Add Note')) {
            return 'VinSolutions_AddNote';
          }
          if (/Contact/i.test(path)) return 'VinSolutions_ContactRecord';
          return 'VinSolutions_' + (path.replace(/\//g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'home');
        }
        return `${PLATFORM}_${path.split('/').filter(Boolean).slice(-2).join('_') || 'page'}`;
      } catch {
        return 'unknown';
      }
    }

    // ---- Subframe: only inject + heartbeat context (no duplicate lead scan) ----
    if (window !== window.top) {
      browser.runtime.onMessage.addListener((msg: any, _s, sendResponse) => {
        if (msg.type === 'GET_CRM_PAGE_CONTEXT') {
          sendResponse({ context: getCrmPageContextForMessage() });
          return false;
        }
        if (msg.type === 'BREVMONT_INJECT_TEXT' || msg.action === 'INJECT_TEXT') {
          const raw = msg.payload ?? msg.text;
          const text = typeof raw === 'string' ? raw : '';
          if (!text) {
            sendResponse({ success: false, error: 'empty' });
            return false;
          }
          const target =
            (document.activeElement as HTMLElement | null) ||
            (document.querySelector('textarea') as HTMLTextAreaElement | null) ||
            (document.querySelector('[contenteditable="true"]') as HTMLElement | null);
          if (target) {
            safeInjectText(target, text);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No text field found' });
          }
          return true;
        }
        return false;
      });
      return;
    }

    // ---- Top frame: lead scanning + observers ----
    let leadData: LeadScanResult | null = null;

    function scanVinLead(): LeadScanResult | null {
      const dashText = getDashboardScopedText();
      if (!dashText || dashText.length < 30) return null;
      const s = scanVinText(dashText, true);
      if (!s.vehicle) {
        s.vehicle = deepTableVehicleSearch() || null;
      }
      if (!s.vehicle) {
        const allText = gatherAllText();
        s.vehicle = extractVehicle(allText) || null;
      }
      if (s.customerName) {
        const allPageText = gatherAllText();
        if (!allPageText.includes(s.customerName)) return null;
        return s;
      }
      return s.customerName || s.vehicle ? s : null;
    }

    function pushLead(lead: LeadScanResult | null) {
      if (!lead || (!lead.customerName && !lead.vehicle)) return;
      leadData = lead;
      void browser.storage.local.set({
        brevmont_lead: lead,
        brevmont_lead_time: Date.now(),
      });
      if (lead.vehicle) {
        void browser.storage.local.set({
          brevmont_vehicle_info: lead.vehicle,
          brevmont_vehicle_info_time: Date.now(),
        });
      }
      void forwardContext({
        name: lead.customerName || undefined,
        vehicle: lead.vehicle || undefined,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        source: lead.source || undefined,
      });
    }

    function rescan() {
      if (isVinSolutions) {
        const next = scanVinLead();
        if (next) {
          pushLead(next);
        } else if (leadData) {
          leadData = null;
          void browser.storage.local.remove([
            'brevmont_lead',
            'brevmont_lead_time',
            'brevmont_vehicle_info',
            'brevmont_vehicle_info_time',
          ]);
          void forwardContext({ name: undefined, vehicle: undefined, cleared: true });
        }
        return;
      }
      const name = extractContactName(PLATFORM);
      if (name) {
        const lead: LeadScanResult = {
          customerName: name,
          phone: '',
          email: '',
          vehicle: null,
          source: '',
          status: '',
          lastContact: '',
        };
        if (isGmail) {
          const emailEl = document.querySelector('.gD') as HTMLElement | null;
          const emailAddr = emailEl?.getAttribute('email');
          if (emailAddr) lead.email = emailAddr;
        }
        leadData = lead;
        void browser.storage.local.set({ brevmont_lead: lead, brevmont_lead_time: Date.now() });
        void forwardContext({ name, vehicle: undefined, email: lead.email || undefined });
      }
    }

    if (isVinSolutions) {
      rescan();
      setInterval(rescan, 2000);
      const obs = new MutationObserver(() => {
        requestAnimationFrame(rescan);
      });
      if (document.body) {
        obs.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      rescan();
      setInterval(rescan, 3000);
    }

    browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
      if (msg.type === 'GET_CRM_PAGE_CONTEXT') {
        try {
          sendResponse({ context: getCrmPageContextForMessage() });
        } catch {
          sendResponse({ context: 'unknown' });
        }
        return false;
      }
      if (msg.type === 'OPEN_COMMAND_TAB') {
        browser.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
        return false;
      }
      if (msg.type === 'BREVMONT_INJECT_TEXT' || msg.action === 'INJECT_TEXT') {
        const raw = msg.payload ?? msg.text;
        const text = typeof raw === 'string' ? raw : '';
        if (!text) {
          sendResponse({ success: false, error: 'empty' });
          return false;
        }

        if (isVinSolutions) {
          void browser.storage.local.set({
            brevmont_paste_note: text,
            brevmont_paste_note_time: Date.now(),
          });
        }

        const tryTargets: Array<() => HTMLElement | null> = [
          () => (document.activeElement as HTMLElement) || null,
          () => document.querySelector('textarea') as HTMLTextAreaElement | null,
          () => document.querySelector('[contenteditable="true"]') as HTMLElement | null,
        ];
        let injected = false;
        for (const pick of tryTargets) {
          const el = pick();
          if (el) {
            safeInjectText(el, text);
            injected = true;
            break;
          }
        }
        sendResponse({ success: injected, error: injected ? undefined : 'No text field found' });
        return true;
      }
      if (msg.type === 'GET_LEAD_CONTEXT' || msg.type === 'GET_CUSTOMER_CONTEXT') {
        sendResponse({ lead: leadData, context: leadData });
        return false;
      }
      return false;
    });

    dlog('[Brevmont] Conduit content script ready', PLATFORM);
  },
});
