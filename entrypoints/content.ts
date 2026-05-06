/**
 * Brevmont v1.9.1 — Draggable pill, left sidebar for VinSolutions, right for all others.
 * VinSolutions: sidebar on LEFT, 320px. All other platforms: sidebar on RIGHT.
 * Gmail: collapsed by default, 280px. Instagram DMs + FB Marketplace conversations added.
 * LinkedIn: messaging only. Facebook: messages + marketplace/t only.
 */

import './content/styles.css';
import { selectorManager, type SelectorEntry } from './lib/selectors';
import { telemetry } from './lib/telemetry';
import { logEvent, detectPlatform as detectHonestPlatform, mapOutputType } from './lib/honestEvents';
import { dlog } from './lib/dev';
import { addBreadcrumb } from '../lib/breadcrumbs';
import { extractContactName as extractContactNameForPlatform } from './lib/leadContextScan';

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
    '*://web.whatsapp.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    // Inline platform detection — no separate function to avoid Vite minifier collisions
    const _url = window.location.href;
    const PLATFORM: Platform = _url.includes('vinsolutions') || _url.includes('coxautoinc') ? 'vinsolutions'
      : _url.includes('mail.google.com') ? 'gmail'
      : _url.includes('messenger.com') || _url.includes('facebook.com/messages') || _url.includes('facebook.com/marketplace/t/') ? 'facebook'
      : _url.includes('facebook.com') ? 'unknown'
      : _url.includes('linkedin.com') ? 'linkedin'
      : _url.includes('instagram.com/direct') ? 'instagram'
      : _url.includes('instagram.com') ? 'unknown'
      : _url.includes('web.whatsapp.com') ? 'whatsapp'
      : 'unknown';
    dlog('[Brevmont] Content script loaded on', PLATFORM, _url);
    addBreadcrumb({ category: 'state', message: 'content_script_loaded', data: { platform: PLATFORM } }).catch(() => {});
    if (PLATFORM === 'unknown') return;

    // Remote kill switch — quiet mode, no pill or sidebar
    try {
      const ks = await browser.storage.local.get(['brevmont_killed', 'kill_message']);
      if (ks.brevmont_killed) {
        const msg =
          String(ks.kill_message || '').trim() ||
          'Brevmont is temporarily offline for maintenance. Your data is safe.';
        if (document.body && !document.getElementById('brevmont-kill-banner')) {
          const b = document.createElement('div');
          b.id = 'brevmont-kill-banner';
          b.style.cssText =
            'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483646;max-width:480px;background:#0F1419;color:#F8F6F1;padding:14px 20px;border-radius:12px;font:13px Inter,system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.35);text-align:center;line-height:1.45';
          b.textContent = msg;
          document.body.appendChild(b);
        }
        return;
      }
    } catch {
      /* ignore */
    }

    // ===== Version-gated force update =====
    // Background writes brevmont_version_status = {locked, latest, message} when
    // the extension is below minimum_supported_version. If locked, inject a
    // blocking overlay and return BEFORE any selectors/DOM work.
    try {
      const vs = await browser.storage.local.get('brevmont_version_status');
      const status = vs?.brevmont_version_status as { locked?: boolean; latest?: string; message?: string } | undefined;
      if (status?.locked && document.body && !document.getElementById('brevmont-version-lock')) {
        const overlay = document.createElement('div');
        overlay.id = 'brevmont-version-lock';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,20,25,0.92);display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;';
        overlay.innerHTML = `
          <div style="max-width:480px;background:#F8F6F1;color:#0F1419;border-radius:16px;padding:32px 28px;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
            <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#0D6E6E;margin-bottom:12px;font-weight:700;">BREVMONT UPDATE REQUIRED</div>
            <h2 style="font-size:22px;font-weight:800;margin:0 0 10px;line-height:1.25;">Please update the extension</h2>
            <p style="font-size:14px;line-height:1.55;margin:0 0 18px;color:#3A3F43;">${status.message || 'This version of Brevmont is no longer supported.'}</p>
            <p style="font-size:12px;line-height:1.5;margin:0 0 20px;color:#5A6066;">Head to the Chrome Web Store or contact <a href="mailto:founder@brevmont.com" style="color:#0D6E6E;">founder@brevmont.com</a> for the current build.</p>
            <button id="brevmont-version-lock-dismiss" style="background:transparent;border:1px solid #D3CFC5;color:#3A3F43;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;">Dismiss for this tab</button>
          </div>
        `;
        document.body.appendChild(overlay);
        const dismiss = document.getElementById('brevmont-version-lock-dismiss');
        if (dismiss) dismiss.addEventListener('click', () => overlay.remove(), { once: true });
        return; // hard-stop content script on locked version
      }
    } catch (_err) {
      // Version-status read fails → behave as if unlocked, don't block users
    }

    const isVinSolutions = PLATFORM === 'vinsolutions';
    const isGmail = PLATFORM === 'gmail';
    const isFacebook = PLATFORM === 'facebook';
    const isLinkedIn = PLATFORM === 'linkedin';
    const isInstagram = PLATFORM === 'instagram';

    function getOutputLabels() {
      if (isVinSolutions) return { text: 'TEXT MESSAGE', email: 'EMAIL', crm: 'CRM NOTE' };
      if (isGmail) return { text: 'REPLY', email: 'EMAIL', crm: 'NOTE' };
      if (isFacebook) return { text: 'MESSAGE', email: 'EMAIL', crm: 'NOTE' };
      if (isLinkedIn) return { text: 'LINKEDIN MSG', email: 'EMAIL', crm: 'NOTE' };
      if (isInstagram) return { text: 'DM REPLY', email: 'EMAIL', crm: 'NOTE' };
      return { text: 'REPLY', email: 'EMAIL', crm: 'NOTE' };
    }
    const outputLabels = getOutputLabels();

    // Safe contact-name extraction — lives at main() scope so terser
    // cannot tree-shake the definition while keeping call sites.
    function safeExtractContactName(): string | null {
      try { return extractContactNameForPlatform(PLATFORM) || null; } catch { return null; }
    }

    // VinSolutions lead creation timestamp — moved to main() scope
    // so terser cannot tree-shake the definition (same bug as safeExtractContactName).
    function scrapeLeadCreatedAt(): string | null {
      if (!isVinSolutions) return null;
      try {
        for (const el of document.querySelectorAll('td, span, div, label')) {
          const t = (el as HTMLElement).textContent?.trim() || '';
          if (/^Created:?\s*$/i.test(t)) {
            const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
            const val = (next as HTMLElement)?.textContent?.trim();
            if (val && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val)) return val;
          }
        }
        for (const td of document.querySelectorAll('td')) {
          const t = (td as HTMLElement).textContent?.trim() || '';
          if (/Lead Created|Date Created/i.test(t)) {
            const sibling = td.nextElementSibling;
            const val = (sibling as HTMLElement)?.textContent?.trim();
            if (val && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val)) return val;
          }
        }
        const dated = document.querySelector('[data-created], [data-lead-created]');
        if (dated) {
          const val = dated.getAttribute('data-created') || dated.getAttribute('data-lead-created');
          if (val) return val;
        }
        const firstNote = document.querySelector('.activity-note-date, .note-date, [class*="note"] [class*="date"]');
        if (firstNote) {
          const val = (firstNote as HTMLElement).textContent?.trim();
          if (val && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val)) return val;
        }
      } catch { /* never crash */ }
      return null;
    }

    // ===== CLEANUP REGISTRY (Phase T8 / Wave 7) =====
    // Track every interval + MutationObserver so we can unbind on unload /
    // sidebar close. Prevents dangling observers after SPA tab teardown.
    const __CLEANUP: Array<() => void> = [];
    function __addInterval(fn: () => void, ms: number): number {
      const id = (window as any).setInterval(fn, ms);
      __CLEANUP.push(() => { try { (window as any).clearInterval(id); } catch {} });
      return id;
    }
    function __addObserver<T extends MutationObserver | ResizeObserver>(o: T, target: Node | Element, opts?: any): T {
      try { (o as any).observe(target, opts); } catch {}
      __CLEANUP.push(() => { try { (o as any).disconnect(); } catch {} });
      return o;
    }
    function __cleanupAll() {
      while (__CLEANUP.length) {
        try { __CLEANUP.pop()?.(); } catch {}
      }
    }
    try { window.addEventListener('beforeunload', __cleanupAll); } catch {}
    try { window.addEventListener('pagehide', __cleanupAll); } catch {}
    // Back-compat aliases for existing call sites
    const CLEANUP = __CLEANUP;
    const addInterval = __addInterval;
    const addObserver = __addObserver;
    const cleanupAll = __cleanupAll;

    // ===== REMOTE SELECTORS (Phase 1f) =====
    // Kick off an async load of vinsolutions/gmail selectors. Do NOT block —
    // callers fall back to hardcoded literals if this array is still empty.
    let vinSelectors: SelectorEntry[] = [];
    let gmailSelectors: SelectorEntry[] = [];
    if (isVinSolutions) {
      selectorManager.getSelectors('vinsolutions').then(sel => { vinSelectors = sel || []; }).catch(() => {});
    }
    if (isGmail) {
      selectorManager.getSelectors('gmail').then(sel => { gmailSelectors = sel || []; }).catch(() => {});
    }

    // Hybrid query: prefer remote selector config; fall back to the hardcoded
    // literal so a cold first run (or proxy outage) still works.
    function qSel(selectors: SelectorEntry[], purpose: string, hardcoded: string, root: Document | HTMLElement = document): Element | null {
      try {
        if (selectors && selectors.length) {
          const el = selectorManager.query(selectors, purpose, root);
          if (el) return el;
        }
      } catch {}
      try { return (root as Document).querySelector(hardcoded); } catch { return null; }
    }

    // ===== ADDNOTE POPUP RECEIVER (VinSolutions only) =====
    if (isVinSolutions) {
      const pageUrl = window.location.href || '';
      if (pageUrl.includes('AddNote') || (document.body?.innerText || '').includes('Add Note')) {
        setTimeout(async () => {
          try {
            const r = await browser.storage.local.get(['brevmont_paste_note', 'brevmont_paste_note_time']);
            if (r.brevmont_paste_note && r.brevmont_paste_note_time > Date.now() - 30000) {
              const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
              if (textarea) {
                textarea.focus();
                safeInjectText(textarea, r.brevmont_paste_note);
                textarea.style.border = '2px solid #16a34a';
                setTimeout(() => { textarea.style.border = ''; }, 2000);
                await browser.storage.local.remove(['brevmont_paste_note', 'brevmont_paste_note_time']);
              }
            }
          } catch(e) {}
        }, 1000);
      }
    }

    let leadData: any = null;
    let sidebarOpen = false;
    let sidebarRoot: HTMLElement | null = null;
    let isGenerating = false;
    let currentTier = 'floor';

    // Intelligence: last AI output for edit-distance tracking
    let lastAiOutput: { text: string; email: string; crm: string; timestamp: number } | null = null;

    async function getTier(): Promise<string> {
      try {
        const resp = await browser.runtime.sendMessage({ type: 'CHECK_FEATURES' });
        currentTier = resp?.tier || 'floor';
        return currentTier;
      } catch(e) { return 'floor'; }
    }
    async function isFeatureUnlocked(feature: string): Promise<boolean> {
      try {
        const resp = await browser.runtime.sendMessage({ type: 'CHECK_FEATURES' });
        return resp?.features?.[feature] || false;
      } catch(e) { return false; }
    }

    // ===== BUG FIX 1: Safe message sender with reconnect =====
    async function safeSend(msg: any): Promise<any> {
      try {
        // Ping first to check if service worker is alive
        await browser.runtime.sendMessage({ type: 'PING' });
      } catch(e: any) {
        // Service worker dead — show reconnect prompt
        logError('NETWORK_ERROR', 'Service worker disconnected', `platform=${typeof PLATFORM !== 'undefined' ? PLATFORM : 'unknown'}`);
        throw new Error('Brevmont lost connection. Reload this page to reconnect.');
      }
      return browser.runtime.sendMessage(msg);
    }

    // ===== TELEMETRY: Error reporting from content script =====
    let _logErrorCount = 0;
    const _LOG_ERROR_MAX = 20; // max 20 errors per page load to prevent flood
    function logError(errorType: string, errorMessage: string, context?: string) {
      if (_logErrorCount >= _LOG_ERROR_MAX) return;
      _logErrorCount++;
      try {
        browser.runtime.sendMessage({
          type: 'REPORT_ERROR',
          payload: { error_type: errorType, error_message: errorMessage, context }
        }).catch(() => {});
      } catch(e) { /* extension context invalidated — can't report */ }
    }

    function showReconnectBanner(shadow: ShadowRoot) {
      const existing = shadow.getElementById('brevmont-reconnect'); if (existing) return;
      const banner = document.createElement('div'); banner.id = 'brevmont-reconnect';
      banner.innerHTML = `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:10px;margin:8px;text-align:center;font-size:12px;font-family:system-ui">
        <div style="font-weight:600;color:#92400E;margin-bottom:6px">Brevmont needs a refresh</div>
        <button id="brevmont-reload-btn" style="padding:4px 16px;background:#0D6E6E;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">Reload Page</button>
      </div>`;
      shadow.getElementById('o8')?.prepend(banner);
      shadow.getElementById('brevmont-reload-btn')?.addEventListener('click', () => window.location.reload());
    }

    // ===== VINSOLUTIONS SCANNING =====
    const MAKES = 'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';
    const STOP_WORDS = 'Created|Attempted|Contacted|Looking|Wants|Also|Stock|Source|Status|miles|General|Customer|Interested|Trade|lineup|options|inventory|Calculated|Equity|Payoff|hover|details|Bad|Sold|Active|Lost';
    const POISON_BEFORE = /(?:Equity|Payoff|Trade-in|trade\s+value|Credit)\b[\s\S]{0,50}$/i;
    const POISON_AFTER = /^[\s\S]{0,20}(?:Calculated|Payoff|payoff|appraised)/i;

    function isPoisoned(text: string, mi: number, ml: number): boolean {
      return POISON_BEFORE.test(text.slice(Math.max(0, mi - 60), mi)) || POISON_AFTER.test(text.slice(mi + ml, mi + ml + 40));
    }

    function extractVehicle(text: string): string {
      let v = '';
      const vi = text.match(new RegExp('Vehicle Info[\\s\\n]+(20\\d{2}\\s+(?:' + MAKES + ')\\s+[^\\n(]+?)\\s*(?:\\(|\\n|$)', 'i'));
      if (vi) v = vi[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      if (!v) { const am = text.match(new RegExp('Active\\t[\\s\\S]{0,80}?(20\\d{2}\\s+(?:' + MAKES + ')[^\\t\\n]*)', 'i')); if (am) { let x = am[1].trim().replace(/\s+/g, ' '); x = x.replace(new RegExp('\\s+(?:' + STOP_WORDS + ')\\b.*', 'i'), ''); v = x.slice(0, 50); } }
      if (!v) { for (const m of text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')(?:\\s+(?!(?:' + STOP_WORDS + ')\\b)[A-Za-z0-9./-]+){0,5})', 'gi'))) { if (!isPoisoned(text, m.index!, m[0].length)) { v = m[1].trim().replace(/\s+/g, ' ').slice(0, 50); break; } } }
      if (!v) { for (const m of text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + '))', 'gi'))) { if (!isPoisoned(text, m.index!, m[0].length)) { v = m[1].trim().slice(0, 40); break; } } }
      if (!v) { const sv = text.match(/(?:Stock\s*#|Vehicle)\s*:?\s*[\s\S]{0,30}?(20\d{2}\s+\w+\s+[\w-]+)/i); if (sv) v = sv[1].trim().slice(0, 50); }
      // Fallback: look for vehicle in Sales History / Sale Info table rows (Sold/Active/Lost + year+make)
      if (!v) { const sh = text.match(/(?:Sold|Active|Lost)\s+[\s\S]{0,60}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i); if (sh) v = sh[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      // Fallback: "Vehicle(s) of Interest" section
      if (!v) { const voi = text.match(/Vehicle(?:\(s\))?\s*of\s*Interest\s*[\s\S]{0,60}?(20\d{2}\s+\w+(?:\s+\w+){0,4})/i); if (voi) v = voi[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      // Fallback: "Sale Info" section on VinSolutions customer dashboard
      if (!v) { const si = text.match(/Sale\s*Info\s*[\s\S]{0,200}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i); if (si) v = si[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      // Fallback: Find vehicle near customer name — look within 500 chars after the name
      if (!v) {
        const nameMatch = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
        if (nameMatch) {
          const afterName = text.slice(nameMatch.index! + nameMatch[0].length, nameMatch.index! + nameMatch[0].length + 800);
          const nearby = afterName.match(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')\\s+[A-Za-z0-9 /-]+)', 'i'));
          if (nearby) v = nearby[1].trim().replace(/\s+/g, ' ').replace(/\s*\[.*$/, '').slice(0, 50);
        }
      }
      // Last resort: find ANY year+make on the page, take the first non-poisoned one
      if (!v) {
        const anyVehicle = text.match(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')\\s+[A-Za-z0-9]+(?:\\s+[A-Za-z0-9]+){0,3})', 'i'));
        if (anyVehicle) v = anyVehicle[1].trim().replace(/\s+/g, ' ').replace(/\s*\[.*$/, '').slice(0, 50);
      }
      return v ? v.replace(/[.,;:!]+$/, '').trim() : '';
    }

    function extractByLabel(labelText: string): string | null {
      const xpath = `//div[contains(text(),'${labelText}')] | //span[contains(text(),'${labelText}')] | //th[contains(text(),'${labelText}')]`;
      const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!node) return null;
      const next = (node as Element).nextElementSibling;
      if (next && next.textContent?.trim()) return next.textContent.trim();
      const parentNext = (node as Element).parentElement?.nextElementSibling;
      if (parentNext && parentNext.textContent?.trim()) return parentNext.textContent.trim();
      return null;
    }

    function extractVehicleFromTable(root: Document | Element): string | null {
      const rows = [...root.querySelectorAll('tr')];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('th,td')].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
        const idx = cells.findIndex(c => /^vehicle$/i.test(c));
        if (idx >= 0 && cells[idx + 1]) {
          const val = cells[idx + 1];
          // Validate: must contain a year (20XX) to be a real vehicle
          if (/20\d{2}/.test(val)) return val.slice(0, 60);
        }
      }
      return null;
    }

    // BUG 2 FIX: Deep table search — recursively scans document + ALL nested iframes for vehicle in table rows
    // VinSolutions vehicle data is in #salesHistoryViewFrame at iframe depth 3
    function deepTableVehicleSearch(): string | null {
      function searchDoc(doc: Document): string | null {
        // Try row-based extraction (th/td pairs in same row)
        const fromTable = extractVehicleFromTable(doc);
        if (fromTable) return fromTable;
        // Try column-header-indexed search
        const allTables = doc.querySelectorAll('table');
        for (const table of allTables) {
          const headers = [...table.querySelectorAll('th')];
          const vehIdx = headers.findIndex(h => /^vehicle$/i.test((h.textContent || '').trim()));
          if (vehIdx < 0) continue;
          const dataRows = [...table.querySelectorAll('tbody tr, tr')].filter(r => r.querySelector('td'));
          for (const row of dataRows) {
            const cells = [...row.querySelectorAll('td')];
            if (cells[vehIdx]) {
              const val = (cells[vehIdx].textContent || '').replace(/\s+/g, ' ').trim();
              if (/20\d{2}/.test(val)) return val.slice(0, 60);
            }
          }
        }
        // Recurse into nested iframes
        const iframes = doc.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const d = (iframe as HTMLIFrameElement).contentDocument || (iframe as any).contentWindow?.document;
            if (d) {
              const found = searchDoc(d);
              if (found) return found;
            }
          } catch(e) {}
        }
        return null;
      }
      return searchDoc(document);
    }

    function safeInjectText(target: HTMLElement, text: string) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const proto = Object.getPrototypeOf(target);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
                     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        desc?.set?.call(target, text);
      } else if ((target as any).isContentEditable) {
        target.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      } else {
        target.textContent = text;
      }
      target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function scanText(text: string): any {
      // PRIMARY: try extractByLabel for customer name
      let name = '';
      const labelName = extractByLabel('Customer Dashboard');
      if (labelName) name = labelName;
      // FALLBACK: regex extraction
      if (!name) { const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/); if (dm) name = dm[1].trim(); }
      if (!name) { const im = text.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/); if (im) name = im[1].trim(); }
      let phone = ''; const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/); if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');
      // FIX 8: Extract email from VinSolutions DOM
      let email = ''; const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/); if (em) email = em[0];
      // Also try mailto links
      if (!email) {
        const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
        for (const link of mailtoLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href) { email = href.replace('mailto:', '').split('?')[0]; break; }
        }
      }
      // Search iframes for email
      if (!email && isVinSolutions) {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (!doc) continue;
            const links = doc.querySelectorAll('a[href^="mailto:"]');
            for (const link of links) { const href = (link as HTMLAnchorElement).href; if (href) { email = href.replace('mailto:', '').split('?')[0]; break; } }
            if (email) break;
            const bodyEmail = (doc.body?.innerText || '').match(/[\w.-]+@[\w.-]+\.\w{2,}/);
            if (bodyEmail) { email = bodyEmail[0]; break; }
          } catch(e) {}
        }
      }
      // PRIMARY: deep table search across document + all iframes (BUG 2 FIX)
      let vehicle: string | null = deepTableVehicleSearch() || extractByLabel('Vehicle') || null;
      // FALLBACK: regex extraction
      if (!vehicle) vehicle = extractVehicle(text) || null;
      let source = ''; const sm = text.match(/Source:\s*(.+)/i); if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
      let status = ''; const stm = text.match(/Status:\s*(.+)/i); if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
      let lastContact = ''; const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i); if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
      return { customerName: name, phone, email, vehicle, source, status, lastContact };
    }

    // Only inject in top frame — scanning, sidebar, pill all belong to the top frame only
    // Iframes: don't inject pill/sidebar, just return
    // Vehicle scanning happens in the TOP FRAME via gatherAllText() which reads iframe content
    if (window !== window.top) return;

    // ===== POPUP INJECTION FUNCTIONS =====

    async function injectEmailComposeButton() {
      // Wait for CKEditor / email form to fully mount
      await new Promise(r => setTimeout(r, 2500));

      // Find the CKEditor iframe — VinSolutions uses CKEditor for rich text email body
      // Try multiple selectors: CKEditor standard, VinSolutions custom, generic
      function findEditorIframe(): HTMLIFrameElement | null {
        // Phase 1f: prefer remote selector config
        try {
          const remote = qSel(vinSelectors, 'ckeditor_iframe', 'iframe.cke_wysiwyg_frame') as HTMLIFrameElement | null;
          if (remote) return remote;
        } catch {}
        const selectors = [
          'iframe.cke_wysiwyg_frame',
          'iframe[id*="Editor"]',
          'iframe[id*="editor"]',
          'iframe[id*="cke_"]',
          'iframe[title*="Rich Text"]',
          'iframe[title*="editor"]',
          '.cke_contents iframe',
          '[id*="cke_contents"] iframe',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLIFrameElement;
          if (el) { dlog('[Brevmont] Found editor iframe via:', sel); return el; }
        }
        // Last resort: find any iframe whose src is blank/about:blank (CKEditor pattern)
        const allIframes = document.querySelectorAll('iframe');
        for (const iframe of allIframes) {
          const src = iframe.getAttribute('src') || '';
          if (!src || src === 'about:blank' || src === 'javascript:void(0)') {
            // Check if it has a contenteditable body
            try {
              const doc = (iframe as HTMLIFrameElement).contentDocument;
              if (doc?.body?.contentEditable === 'true' || doc?.designMode === 'on') {
                dlog('[Brevmont] Found editor iframe via contentEditable check');
                return iframe as HTMLIFrameElement;
              }
            } catch(e) {}
          }
        }
        return null;
      }

      const subjectInput = qSel(vinSelectors, 'email_subject_input', 'input[id*="subject"], input[id*="Subject"], input[name*="subject"], input[name*="Subject"]') as HTMLInputElement;

      // Create the Generate button — floating top-right of the popup so it
      // doesn't distort the CKEditor toolbar layout. Injecting into
      // .cke_top broke the toolbar spacing on VinConnect's email compose.
      const btn = document.createElement('button');
      btn.textContent = 'Generate with Brevmont';
      btn.id = 'brevmont-email-generate';
      btn.type = 'button'; // Prevent form submission
      Object.assign(btn.style, {
        background: '#0D6E6E', color: '#fff', border: 'none', borderRadius: '8px',
        padding: '8px 16px', fontSize: '13px', fontWeight: '600', fontFamily: 'system-ui,sans-serif',
        cursor: 'pointer', whiteSpace: 'nowrap',
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        boxShadow: '0 2px 6px rgba(0,0,0,.18)',
      });
      btn.onmouseenter = () => { btn.style.background = '#0A5555'; };
      btn.onmouseleave = () => { btn.style.background = '#0D6E6E'; };

      // Anchor to body so the toolbar doesn't reflow.
      document.body.appendChild(btn);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = 'Generating...'; btn.disabled = true;

        try {
          // Extract customer name from popup DOM
          const customerEl = document.querySelector('[id*="customer"], [id*="CustomerName"], [id*="name"], .customer-name, h1, h2, [class*="header"] span');
          const customerName = customerEl?.textContent?.trim() || '';
          const toField = qSel(vinSelectors, 'email_to_input', 'input[id*="to"], input[id*="To"], input[name*="to"], input[type="email"]') as HTMLInputElement;
          const toEmail = toField?.value || '';

          dlog('[Brevmont] Email popup: customer=' + customerName + ', to=' + toEmail);

          // Route through the background script so the request goes out with
          // the correct { messages: [{role, content}] } shape AND the HMAC
          // signing headers that Phase 2 enforcement requires. The old direct
          // fetch from here used `user_message` (wrong) and was unsigned.
          const response: any = await browser.runtime.sendMessage({
            type: 'GENERATE_OUTPUT',
            payload: {
              type: 'email',
              leadContext: { customerName, customerEmail: toEmail, vehicle: null },
              repInput: 'Follow up from the CRM. Keep it warm and professional.',
              repName: '', dealership: '',
              platform: 'vinsolutions',
              metadata: { workflow_type: 'email', customer_name: customerName, email: toEmail, vehicle: null },
            },
          });
          if (response?.error) throw new Error(response.error);
          const raw = response?.sections?.email || response?.text || '';
          if (!raw) throw new Error('Empty response from proxy');

          dlog('[Brevmont] Email generated, length=' + raw.length);

          // Parse subject and body from response
          const subjectMatch = raw.match(/Subject:\s*(.+?)(?:\n|$)/i);
          const emailBody = raw.replace(/^(?:EMAIL\s*\n)?Subject:\s*.+?\n\n?/i, '').trim();

          // Auto-populate subject
          if (subjectInput && subjectMatch?.[1]) {
            safeInjectText(subjectInput, subjectMatch[1].trim());
            dlog('[Brevmont] Subject injected');
          }

          // Auto-populate body — SAFELY into the CKEditor iframe
          const editorFrame = findEditorIframe();
          if (editorFrame) {
            try {
              const innerDoc = editorFrame.contentDocument || editorFrame.contentWindow?.document;
              if (innerDoc) {
                // Wait for CKEditor to be ready
                if (innerDoc.readyState !== 'complete') {
                  await new Promise(r => setTimeout(r, 500));
                }
                // Convert plain text to HTML paragraphs
                const htmlBody = emailBody.split('\n').filter((l: string) => l.trim()).map((p: string) => `<p>${p}</p>`).join('');

                // PRESERVE the existing dealership template / signature. The
                // VinConnect email body already has a header (dealership logo,
                // "No Photo" placeholder, sales rep block). Blowing it away
                // with innerHTML = ... erases the signature every dealer paid
                // to set up. Instead: prepend the generated paragraphs at the
                // top of the body so the rep's signature stays intact.
                const existingHTML = innerDoc.body.innerHTML || '';
                const looksEmpty = !existingHTML.trim() || existingHTML === '<p>&nbsp;</p>' || existingHTML === '<br>';
                if (looksEmpty) {
                  innerDoc.body.innerHTML = htmlBody;
                } else {
                  // Insert a hidden marker + the new paragraphs before the existing content.
                  const marker = '<!--brevmont-generated-start-->';
                  const endMarker = '<!--brevmont-generated-end-->';
                  // If a prior generation is still present, replace it; else insert fresh.
                  const existingMarkerStart = existingHTML.indexOf(marker);
                  const existingMarkerEnd = existingHTML.indexOf(endMarker);
                  if (existingMarkerStart >= 0 && existingMarkerEnd > existingMarkerStart) {
                    innerDoc.body.innerHTML =
                      existingHTML.slice(0, existingMarkerStart) +
                      marker + htmlBody + endMarker +
                      existingHTML.slice(existingMarkerEnd + endMarker.length);
                  } else {
                    innerDoc.body.innerHTML = marker + htmlBody + endMarker + existingHTML;
                  }
                }
                dlog('[Brevmont] Email body injected, preserved existing signature');
              }
            } catch(frameErr: any) {
              console.error('[Brevmont] Iframe write failed:', frameErr.message);
              logError('DOM_ERROR', frameErr.message || 'Iframe write failed', 'email_iframe_inject');
              // Fallback: try execCommand
              try {
                editorFrame.contentWindow?.focus();
                const innerDoc = editorFrame.contentDocument;
                if (innerDoc) {
                  innerDoc.execCommand('selectAll', false);
                  innerDoc.execCommand('insertHTML', false, emailBody.split('\n').filter((l: string) => l.trim()).map((p: string) => `<p>${p}</p>`).join(''));
                  dlog('[Brevmont] Email body injected via execCommand');
                }
              } catch(cmdErr: any) {
                console.error('[Brevmont] execCommand fallback failed:', cmdErr.message);
              }
            }
          } else {
            // No iframe found — try textarea fallback
            const bodyTextarea = document.querySelector('textarea[id*="body"], textarea[id*="Body"], textarea[id*="content"], textarea[name*="body"]') as HTMLTextAreaElement;
            if (bodyTextarea) {
              safeInjectText(bodyTextarea, emailBody);
              dlog('[Brevmont] Email body injected via textarea fallback');
            } else {
              console.error('[Brevmont] No editor iframe or textarea found');
              // Copy to clipboard as last resort
              navigator.clipboard.writeText(emailBody);
              const toast = document.createElement('div');
              toast.textContent = 'Email copied to clipboard. Paste into body field.';
              Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#C4841D', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 4000);
            }
          }

          // Success toast
          const toast = document.createElement('div');
          toast.textContent = 'Email generated. Review and send.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);

          btn.textContent = 'Generate with Brevmont'; btn.disabled = false;
        } catch(e: any) {
          console.error('[Brevmont] Email popup error:', e.message);
          logError('API_ERROR', e.message || 'Email popup generation failed', 'vinsolutions_email_popup');
          btn.textContent = 'Error. Try again.'; btn.disabled = false;
          setTimeout(() => { btn.textContent = 'Generate with Brevmont'; }, 2000);
        }
      });
    }

    async function injectCallLogButton() {
      // Wait for the call log form to fully load
      await new Promise(r => setTimeout(r, 2000));

      // Find the Call Notes textarea — try many selectors
      function findNotesField(): HTMLTextAreaElement | null {
        // Phase 1f: prefer remote selector config
        try {
          const remote = qSel(vinSelectors, 'call_note_textarea', 'textarea[id*="CallNote"]') as HTMLTextAreaElement | null;
          if (remote) return remote;
        } catch {}
        const selectors = [
          'textarea[id*="CallNote"]', 'textarea[id*="callNote"]',
          'textarea[id*="Notes"]', 'textarea[id*="notes"]',
          'textarea[name*="CallNote"]', 'textarea[name*="Notes"]',
          'textarea[id*="comment"]', 'textarea[id*="Comment"]',
          'textarea[id*="note"]', 'textarea[id*="Note"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLTextAreaElement;
          if (el) { dlog('[Brevmont] Found call notes textarea via:', sel); return el; }
        }
        // Last resort: find the largest textarea on the page
        const allTextareas = document.querySelectorAll('textarea');
        dlog('[Brevmont] Call log: found ' + allTextareas.length + ' textareas total');
        if (allTextareas.length === 1) return allTextareas[0] as HTMLTextAreaElement;
        // If multiple, pick the biggest one (most likely the notes field)
        let biggest: HTMLTextAreaElement | null = null;
        let maxArea = 0;
        allTextareas.forEach(ta => {
          const rect = (ta as HTMLElement).getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > maxArea) { maxArea = area; biggest = ta as HTMLTextAreaElement; }
        });
        if (biggest) dlog('[Brevmont] Using largest textarea as call notes field');
        return biggest;
      }

      const notesField = findNotesField();
      if (!notesField) {
        console.error('[Brevmont] Call log: no notes textarea found on page');
        return;
      }

      // Create the Generate button
      const btn = document.createElement('button');
      btn.textContent = 'Generate Call Note';
      btn.id = 'brevmont-callnote-generate';
      btn.type = 'button'; // Prevent form submission
      Object.assign(btn.style, {
        background: '#0D6E6E', color: '#fff', border: 'none', borderRadius: '8px',
        padding: '6px 14px', fontSize: '12px', fontWeight: '600', fontFamily: 'system-ui,sans-serif',
        cursor: 'pointer', margin: '4px 0', whiteSpace: 'nowrap', display: 'block'
      });
      btn.onmouseenter = () => { btn.style.background = '#0A5555'; };
      btn.onmouseleave = () => { btn.style.background = '#0D6E6E'; };

      // Insert before the textarea
      notesField.parentElement?.insertBefore(btn, notesField);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = 'Generating...'; btn.disabled = true;

        try {
          const customerEl = document.querySelector('[id*="customer"], [id*="CustomerName"], [id*="name"], .customer-name, h1, h2');
          const customerName = customerEl?.textContent?.trim() || '';
          dlog('[Brevmont] Call log: generating for customer=' + customerName);

          // Route through background script so the request has the correct
          // { messages:[{role,content}] } shape and signed headers. The old
          // direct fetch used `user_message` and was unsigned — 401/400.
          const response: any = await browser.runtime.sendMessage({
            type: 'GENERATE_OUTPUT',
            payload: {
              type: 'crm',
              leadContext: { customerName, vehicle: null },
              repInput: `Phone call logged. Write a CRM NOTE capturing next step, what happened, and current status.`,
              repName: '', dealership: '',
              platform: 'vinsolutions',
              metadata: { workflow_type: 'crm', customer_name: customerName, vehicle: null },
            },
          });
          if (response?.error) throw new Error(response.error);
          let note = response?.sections?.crm || response?.text || '';
          if (!note) throw new Error('Empty response from proxy');

          // Strip any "CRM NOTE" label prefix
          note = note.replace(/^CRM\s*NOTE\s*\n?/i, '').trim();

          dlog('[Brevmont] Call note generated, length=' + note.length);

          // Write to textarea using native setter + fire events for ASP.NET form state
          safeInjectText(notesField, note);
          // Fire input + change events — ASP.NET won't register the value without these
          notesField.dispatchEvent(new Event('input', { bubbles: true }));
          notesField.dispatchEvent(new Event('change', { bubbles: true }));
          notesField.dispatchEvent(new Event('blur', { bubbles: true }));
          dlog('[Brevmont] Call note injected + events dispatched');

          const toast = document.createElement('div');
          toast.textContent = 'Call note generated.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);

          btn.textContent = 'Generate Call Note'; btn.disabled = false;
        } catch(e: any) {
          btn.textContent = 'Error. Try again.'; btn.disabled = false;
          console.error('[Brevmont] Call log generate error:', e);
          logError('API_ERROR', e?.message || 'Call log generation failed', 'vinsolutions_call_log');
          setTimeout(() => { btn.textContent = 'Generate Call Note'; }, 2000);
        }
      });
    }

    async function injectTextMessageButton() {
      // The VinSolutions texting popup (rims2.aspx?...VinWFETexting) loads a
      // message composer with a textarea + Send button. The dealership-text
      // integration is the "deal closer" flow — reps hit Text on the customer,
      // this popup opens with the phone number pre-filled, and they type.
      // Inject a floating "Generate with Brevmont" button so one click drops
      // a generated SMS directly into the textarea.
      await new Promise(r => setTimeout(r, 1500));

      function findMessageField(): HTMLTextAreaElement | HTMLInputElement | null {
        const byId = document.querySelector(
          'textarea[id*="message" i], textarea[id*="body" i], textarea[name*="message" i], textarea[name*="body" i]'
        ) as HTMLTextAreaElement | null;
        if (byId) return byId;
        // Fallback: biggest textarea in the popup.
        const all = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
        if (all.length === 1) return all[0];
        let biggest: HTMLTextAreaElement | null = null; let area = 0;
        for (const ta of all) {
          const r = ta.getBoundingClientRect();
          const a = r.width * r.height;
          if (a > area) { area = a; biggest = ta; }
        }
        return biggest;
      }

      const field = findMessageField();
      if (!field) { console.warn('[Brevmont] Text popup: no message textarea found'); return; }

      const btn = document.createElement('button');
      btn.textContent = 'Generate with Brevmont';
      btn.id = 'brevmont-text-generate';
      btn.type = 'button';
      Object.assign(btn.style, {
        background: '#0D6E6E', color: '#fff', border: 'none', borderRadius: '8px',
        padding: '8px 16px', fontSize: '13px', fontWeight: '600', fontFamily: 'system-ui,sans-serif',
        cursor: 'pointer', whiteSpace: 'nowrap',
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        boxShadow: '0 2px 6px rgba(0,0,0,.18)',
      });
      btn.onmouseenter = () => { btn.style.background = '#0A5555'; };
      btn.onmouseleave = () => { btn.style.background = '#0D6E6E'; };
      document.body.appendChild(btn);

      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.textContent = 'Generating...'; btn.disabled = true;

        try {
          const customerEl = document.querySelector('[id*="customer" i], [id*="CustomerName" i], h1, h2, [class*="header" i] span');
          const customerName = customerEl?.textContent?.trim() || '';
          const phoneField = document.querySelector('input[id*="phone" i], input[id*="Phone" i], input[name*="phone" i]') as HTMLInputElement | null;
          const phone = phoneField?.value || '';

          const response: any = await browser.runtime.sendMessage({
            type: 'GENERATE_OUTPUT',
            payload: {
              type: 'text',
              leadContext: { customerName, customerPhone: phone, vehicle: null },
              repInput: 'Follow-up SMS to the customer. Keep it 2-3 sentences max.',
              repName: '', dealership: '',
              platform: 'vinsolutions',
              metadata: { workflow_type: 'text', customer_name: customerName, vehicle: null },
            },
          });
          if (response?.error) throw new Error(response.error);
          let msg = response?.sections?.text || response?.text || '';
          if (!msg) throw new Error('Empty response from proxy');
          msg = msg.replace(/^TEXT\s*\n?/i, '').trim();

          safeInjectText(field as HTMLElement, msg);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));

          const toast = document.createElement('div');
          toast.textContent = 'Text generated. Review before sending.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'2147483647' });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);

          btn.textContent = 'Generate with Brevmont'; btn.disabled = false;
        } catch (err: any) {
          btn.textContent = 'Error. Try again.'; btn.disabled = false;
          console.error('[Brevmont] Text popup generate error:', err);
          logError('API_ERROR', err?.message || 'Text popup generation failed', 'vinsolutions_text_popup');
          setTimeout(() => { btn.textContent = 'Generate with Brevmont'; }, 2000);
        }
      });
    }

    // ===== VINSOLUTIONS POPUP HANDLER (email compose, call log, text) =====
    // These open in separate Chrome windows with their own DOM. Skip pill/sidebar,
    // inject a toolbar button instead. This is the deal-closer feature.
    if (isVinSolutions) {
      const popupUrl = window.location.href.toLowerCase();
      if (popupUrl.includes('sendemail.aspx') || popupUrl.includes('communication') && popupUrl.includes('email')) {
        dlog('[Brevmont] Email compose popup detected');
        injectEmailComposeButton();
        return; // Don't inject pill/sidebar in popup
      }
      if (popupUrl.includes('logcallv2') || popupUrl.includes('logcall')) {
        dlog('[Brevmont] Call log popup detected');
        injectCallLogButton();
        return; // Don't inject pill/sidebar in popup
      }
      // Text message popup: rims2.aspx?urlSettingName=Communication.VinWFETexting...
      // Dealers who have VinSolutions texting configured open a dedicated popup
      // with its own message textarea. Inject a button so the rep gets one-click
      // "generate + drop into the text box" without leaving the popup.
      if (popupUrl.includes('rims2') && (popupUrl.includes('texting') || popupUrl.includes('vinwfetexting') || popupUrl.includes('textmessage'))) {
        dlog('[Brevmont] Text message popup detected');
        injectTextMessageButton();
        return; // Don't inject pill/sidebar in popup
      }
    }

    // ===== FIX 6: HARD GUARD — never inject twice =====
    if (document.getElementById('brevmont-sidebar')) return;
    if (document.getElementById('brevmont-host')) return;

    // ===== FIX 1: Wait for VinSolutions page to be ready =====
    if (isVinSolutions) {
      const waitForReady = () => new Promise<void>((resolve) => {
        const check = () => {
          const hasContent = document.querySelector('iframe') || document.body.innerText.length > 100;
          if (hasContent && document.readyState === 'complete') {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        if (document.readyState === 'complete') {
          setTimeout(check, 1000);
        } else {
          window.addEventListener('load', () => setTimeout(check, 1000));
        }
      });
      await waitForReady();
    }

    // Clean stale markers from failed SPA injects
    if (isFacebook || isInstagram) {
      const staleMarker = document.getElementById('brevmont-sidebar');
      const staleHost = document.getElementById('brevmont-host');
      if (staleMarker && !staleHost) staleMarker.remove();
    }
    if (document.getElementById('brevmont-sidebar')) return;
    if (document.getElementById('brevmont-host')) return;

    dlog(`[Brevmont] Injection proceeding — platform: ${PLATFORM}, isTop: ${window === window.top}`);

    // ===== VINSOLUTIONS SCANNING (top frame only, anchored to Customer Dashboard) =====
    if (isVinSolutions) {
      // Gather text from page + all accessible iframes (RECURSIVE)
      // VinSolutions nests iframes 3 levels deep:
      //   document → #cardashboardframe → #rightpaneframe → #salesHistoryViewFrame
      // Non-recursive version only read depth 0 and missed all customer data.
      function gatherAllText(): string {
        let text = document.body?.innerText || '';
        function readIframes(doc: Document) {
          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of iframes) {
            try {
              const d = (iframe as HTMLIFrameElement).contentDocument || (iframe as any).contentWindow?.document;
              if (d?.body) {
                text += '\n' + d.body.innerText;
                readIframes(d); // recurse into nested iframes
              }
            } catch(e) {} // cross-origin silently fails
          }
        }
        readIframes(document);
        return text;
      }

      // Extract ONLY the text after "Customer Dashboard" heading to avoid picking up
      // names from the left lead list panel. Everything before that marker is ignored.
      function getDashboardScopedText(): string {
        const full = gatherAllText();
        const idx = full.search(/Customer Dashboard/i);
        if (idx === -1) return '';
        return full.slice(idx);
      }

      function attemptScan() {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) return;
        // Name/phone/email come from dashboard-scoped text only
        const s = scanText(dashText);
        // Vehicle: try deep table search first, then regex on broader page text
        if (!s.vehicle) {
          s.vehicle = deepTableVehicleSearch() || null;
        }
        if (!s.vehicle) {
          const allText = gatherAllText();
          s.vehicle = extractVehicle(allText) || null;
        }
        if (s.customerName) {
          // Validate: name must appear in gathered text (recursive iframe read)
          const allPageText = gatherAllText();
          if (!allPageText.includes(s.customerName)) return; // stale data, skip
          leadData = s;
          browser.storage.local.set({ brevmont_lead: s, brevmont_lead_time: Date.now() });
        }
        if (s.vehicle) browser.storage.local.set({ brevmont_vehicle_info: s.vehicle, brevmont_vehicle_info_time: Date.now() });
      }
      attemptScan();
      let lastScannedName = '';

      // ===== ACTIVE PERIODIC RESCAN (every 2s) =====
      // MutationObserver CANNOT see changes inside iframes. VinSolutions loads customer
      // data in right-panel iframes WITHOUT changing the URL. The only reliable way to
      // detect customer changes is to periodically read the visible text and compare.
      addInterval(() => {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) {
          // No Customer Dashboard visible — user is on main dashboard or navigating
          // Clear stale data if we had a customer before
          if (leadData) {
            leadData = null;
            lastScannedName = '';
            browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
            updateSidebar();
          }
          return;
        }
        // Extract current customer name from visible text
        const nm = dashText.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/)
          || dashText.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) {
          // Customer changed — clear old data, scan fresh
          dlog(`[Brevmont] Customer changed: "${lastScannedName}" → "${curName}"`);
          lastScannedName = curName;
          leadData = null;
          browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
          attemptScan();
          // Also update sidebar immediately with fresh data
          if (leadData) updateSidebar();
          // Retry scan after 1.5s in case iframes haven't fully loaded yet
          setTimeout(() => {
            attemptScan();
            updateSidebar();
          }, 1500);
        } else if (curName && leadData?.customerName === curName && !leadData?.vehicle) {
          // Same customer but vehicle still missing — retry vehicle detection
          const v = deepTableVehicleSearch();
          if (v) {
            leadData.vehicle = v;
            browser.storage.local.set({ brevmont_lead: leadData, brevmont_lead_time: Date.now(), brevmont_vehicle_info: v, brevmont_vehicle_info_time: Date.now() });
            updateSidebar();
          }
        }
      }, 2000);

      // Also keep MutationObserver for fast detection when parent DOM changes
      let scanTimeout: ReturnType<typeof setTimeout> | null = null;
      const vinObserver = new MutationObserver(() => {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          const dashText = getDashboardScopedText();
          const nm = dashText.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/) || dashText.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
          const curName = nm ? nm[1].trim() : '';
          if (curName && curName !== lastScannedName) {
            dlog(`[Brevmont] MutationObserver detected: "${lastScannedName}" → "${curName}"`);
            lastScannedName = curName;
            leadData = null;
            browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
            attemptScan();
            updateSidebar();
          }
        }, 500);
      });
      const mainPanel = qSel(vinSelectors, 'main_panel', '#mainAreaPanel') || document.body;
      addObserver(vinObserver, mainPanel, { childList: true, subtree: true, characterData: true });
    }

    // ===== SIDEBAR WIDTH PER PLATFORM =====
    function getSidebarWidth(): string {
      if (isGmail) return '260px';
      if (isInstagram) return '280px';
      if (isVinSolutions) return '340px';
      return '300px';
    }

    // ===== PILL (one only — guard against duplicates) =====
    if (document.getElementById('brevmont-pill')) {
      dlog('[Brevmont] Pill already exists, skipping creation');
    }
    let pill: HTMLElement | null = document.getElementById('brevmont-pill') as HTMLElement || document.createElement('div');
    if (!pill.id) {
      pill.id = 'brevmont-pill';
      pill.textContent = 'BM';

      Object.assign(pill.style, {
        position:'fixed', zIndex:'9999',
        background:'#0D6E6E', color:'#fff', padding:'5px 8px', borderRadius:'6px',
        fontSize:'11px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'pointer',
        boxShadow:'0 2px 8px rgba(13,110,110,0.3)', letterSpacing:'0.5px',
        visibility:'hidden', opacity:'0', // Hidden until positioned
        userSelect:'none', whiteSpace:'nowrap',
        willChange:'opacity', transition:'opacity 0.15s, background 0.15s'
      });

      pill.onmouseenter = () => { if(pill) { pill.style.opacity = '1'; pill.textContent = 'Brevmont'; } };
      pill.onmouseleave = () => { if(pill) { pill.style.opacity = '0.85'; pill.textContent = 'BM'; } };
      pill.onclick = () => { sidebarOpen ? closeSidebar() : openSidebar(); };
      document.documentElement.appendChild(pill);
      addBreadcrumb({ category: 'state', message: 'pill_mounted', data: { platform: PLATFORM } }).catch(() => {});
    }

    function findPanelSeamX(): { seamX: number; panelTop: number; panelHeight: number } | null {
      // Strategy 1: find the thin vertical scrollbar/divider between left and right panels
      const candidates = [
        document.getElementById('customerListScrollBarHolder'),
        document.getElementById('scrollBarHolder'),
        document.querySelector('.scrollBarDiv'),
        document.querySelector('[id*="ScrollBar"]'),
        document.querySelector('[class*="scrollBar"]'),
      ].filter(Boolean);

      for (const el of candidates) {
        if (!el) continue;
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width < 20 && r.height > 100) {
          return { seamX: r.right, panelTop: r.top, panelHeight: r.height };
        }
      }

      // Strategy 2: scan ALL divs for a thin vertical element at the panel boundary
      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        const r = div.getBoundingClientRect();
        if (r.width >= 4 && r.width <= 12 && r.height > 300 && r.left > 200 && r.left < 900) {
          return { seamX: r.right, panelTop: r.top, panelHeight: r.height };
        }
      }

      // Strategy 3: look inside cardashboardframe for leftpaneframe
      try {
        const cf = qSel(vinSelectors, 'customer_dashboard_frame', '#cardashboardframe') as HTMLIFrameElement | null;
        if (cf) {
          const cfd = cf.contentDocument || (cf as any).contentWindow?.document;
          if (cfd) {
            const lf = qSel(vinSelectors, 'left_pane_frame', '#leftpaneframe', cfd) as HTMLElement | null;
            if (lf) {
              const cfRect = cf.getBoundingClientRect();
              const lfRect = lf.getBoundingClientRect();
              return {
                seamX: cfRect.x + lfRect.right,
                panelTop: cfRect.y,
                panelHeight: cfRect.height
              };
            }
          }
        }
      } catch(e) {}

      // Strategy 4: use #mainAreaPanel right edge as fallback
      const map = (qSel(vinSelectors, 'main_panel', '#mainAreaPanel') as HTMLElement | null);
      if (map) {
        const r = map.getBoundingClientRect();
        if (r.width > 100 && r.width < window.innerWidth * 0.7) {
          return { seamX: r.right, panelTop: r.top, panelHeight: r.height };
        }
      }

      // Strategy 5: find the right panel dynamically by locating "Customer Dashboard" heading
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"]');
      for (const h of headings) {
        if (h.textContent?.trim().startsWith('Customer Dashboard')) {
          // Walk up to find the panel container
          let panel: HTMLElement | null = h as HTMLElement;
          for (let i = 0; i < 5 && panel; i++) {
            panel = panel.parentElement;
            if (panel) {
              const r = panel.getBoundingClientRect();
              if (r.width > 200 && r.height > 200) {
                return { seamX: r.left, panelTop: r.top, panelHeight: r.height };
              }
            }
          }
        }
      }

      // Strategy 6: cardashboardframe left edge as final fallback
      const cdf = (qSel(vinSelectors, 'customer_dashboard_frame', '#cardashboardframe') as HTMLElement | null);
      if (cdf) {
        const r = cdf.getBoundingClientRect();
        if (r.width > 100) {
          return { seamX: r.left, panelTop: r.top, panelHeight: r.height };
        }
      }

      return null;
    }

    function updateGmailPillBadge(count: number) {
      if (!pill || !isGmail) return;
      let badge = pill.querySelector('.brevmont-pill-badge') as HTMLElement;
      if (count <= 0) { if (badge) badge.remove(); return; }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'brevmont-pill-badge';
        Object.assign(badge.style, { position:'absolute', top:'-4px', right:'-4px', minWidth:'16px', height:'16px', borderRadius:'8px', background:'#0D6E6E', color:'#fff', fontSize:'9px', fontWeight:'700', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px', border:'2px solid #fff' });
        pill.style.position = 'fixed'; // ensure positioning context
        pill.appendChild(badge);
      }
      badge.textContent = String(count);
    }

    function updatePillPosition() {
      if (!pill || pill.style.display === 'none') return;
      if (isVinSolutions) {
        const seam = findPanelSeamX();
        if (seam) {
          const pillWidth = pill.offsetWidth || 44;
          pill.style.left = (seam.seamX - pillWidth - 24) + 'px';
          pill.style.top = (seam.panelTop + seam.panelHeight * 0.45) + 'px';
          pill.style.transform = 'translateY(-50%)';
          pill.style.right = 'auto';
          pill.style.visibility = 'visible';
          pill.style.opacity = '0.85';
        }
      } else if (isGmail) {
        pill.style.left = '92px';
        pill.style.top = '515px';
        pill.style.bottom = 'auto';
        pill.style.right = 'auto';
        pill.style.transform = 'none';
        pill.style.borderRadius = '16px';
        pill.style.padding = '6px 14px';
        pill.style.fontSize = '11px';
        pill.style.visibility = 'visible';
        pill.style.opacity = '0.9';
      } else if (isLinkedIn) {
        pill.style.right = '20px';
        pill.style.top = '70px';
        pill.style.left = 'auto';
        pill.style.bottom = 'auto';
        pill.style.transform = 'none';
        pill.style.borderRadius = '16px';
        pill.style.padding = '6px 14px';
        pill.style.fontSize = '11px';
        pill.style.visibility = 'visible';
        pill.style.opacity = '0.9';
      } else if (isFacebook) {
        pill.style.left = '72px';
        pill.style.top = '50%';
        pill.style.bottom = 'auto';
        pill.style.right = 'auto';
        pill.style.transform = 'translateY(-50%)';
        pill.style.borderRadius = '16px';
        pill.style.padding = '6px 14px';
        pill.style.fontSize = '11px';
        pill.style.visibility = 'visible';
        pill.style.opacity = '0.9';
      } else {
        pill.style.left = '0';
        pill.style.top = '50%';
        pill.style.transform = 'translateY(-50%)';
        pill.style.borderRadius = '0 8px 8px 0';
        pill.style.visibility = 'visible';
        pill.style.opacity = '0.85';
      }
    }

    updatePillPosition();

    // Keep pill + sidebar locked to divider on resize/zoom/fullscreen
    const pillResizeObserver = new ResizeObserver(() => { requestAnimationFrame(() => { updatePillPosition(); updateSidebarPosition(); }); });
    addObserver(pillResizeObserver, document.documentElement);
    window.addEventListener('resize', () => { updatePillPosition(); updateSidebarPosition(); });
    window.addEventListener('fullscreenchange', () => { updatePillPosition(); updateSidebarPosition(); });
    addInterval(() => { updatePillPosition(); updateSidebarPosition(); }, 1000);

    // ===== MODAL AWARENESS: Hide pill + sidebar when VinSolutions modals are visible =====
    if (isVinSolutions) {
      let pillHiddenByModal = false;
      function checkForModals() {
        // Remote-config selector first (purpose: modal_overlay), then hardcoded fallbacks
        const remoteModal = qSel(vinSelectors, 'modal_overlay', '.ui-dialog:not([style*="display: none"])');
        let modalVisible = false;
        if (remoteModal) {
          const rect = (remoteModal as HTMLElement).getBoundingClientRect();
          modalVisible = rect.width > 0 && rect.height > 0;
        }
        // VinSolutions uses jQuery UI dialogs, Bootstrap modals, and native role="dialog"
        const modalSelectors = [
          '.ui-dialog:not([style*="display: none"])',
          '.ui-widget-overlay',
          '.modal.show', '.modal.in', '.modal[style*="display: block"]',
          '[role="dialog"]:not([aria-hidden="true"])',
          '.k-overlay', // Kendo UI overlay
          '#simplemodal-overlay', '#simplemodal-container',
          '.blockUI.blockOverlay',
        ];
        if (!modalVisible) {
          modalVisible = modalSelectors.some(sel => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const rect = (el as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        }

        // Also check iframes for modals (VinSolutions opens modals inside iframes)
        let iframeModal = false;
        try {
          document.querySelectorAll('iframe').forEach(iframe => {
            try {
              const idoc = iframe.contentDocument;
              if (!idoc) return;
              if (idoc.querySelector('.ui-dialog:not([style*="display: none"])') ||
                  idoc.querySelector('.ui-widget-overlay') ||
                  idoc.querySelector('[role="dialog"]:not([aria-hidden="true"])')) {
                iframeModal = true;
              }
            } catch(e) {} // cross-origin iframes will throw
          });
        } catch(e) {}

        const shouldHide = modalVisible || iframeModal;

        if (shouldHide && !pillHiddenByModal) {
          pillHiddenByModal = true;
          if (pill) { pill.style.visibility = 'hidden'; pill.style.pointerEvents = 'none'; }
          if (sidebarRoot) { sidebarRoot.style.visibility = 'hidden'; sidebarRoot.style.pointerEvents = 'none'; }
        } else if (!shouldHide && pillHiddenByModal) {
          pillHiddenByModal = false;
          if (pill && !sidebarOpen) { pill.style.visibility = 'visible'; pill.style.pointerEvents = 'auto'; }
          if (sidebarRoot && sidebarOpen) { sidebarRoot.style.visibility = 'visible'; sidebarRoot.style.pointerEvents = 'auto'; }
        }
      }

      // Check every 500ms (modals open/close asynchronously)
      addInterval(checkForModals, 500);

      // Also watch for DOM changes that might indicate modal insertion
      const modalObserver = new MutationObserver(() => { requestAnimationFrame(checkForModals); });
      addObserver(modalObserver, document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
    }

    // ===== NON-VINSOLUTIONS: Lightweight contact name watcher =====
    // VinSolutions has its own deep scanning. For all other platforms, periodically
    // extract the contact name from the conversation header so it's ready when the
    // rep generates output. This runs every 3 seconds and is cheap (DOM queries only).
    if (!isVinSolutions) {
      addInterval(() => {
        const name = extractContactNameForPlatform(PLATFORM);
        if (name && (!leadData || !leadData.customerName)) {
          leadData = leadData || {};
          leadData.customerName = name;
          // Gmail: also grab email from sender element
          if (isGmail) {
            const emailEl = qSel(gmailSelectors, 'sender_email_badge', '.gD');
            if (emailEl) {
              const emailAddr = emailEl.getAttribute('email');
              if (emailAddr) leadData.email = emailAddr;
            }
          }
          dlog('[Brevmont] Auto-captured contact:', name);
        }
        // If the name changed (user switched conversations), update leadData
        if (name && leadData && leadData.customerName && leadData.customerName !== name) {
          leadData.customerName = name;
          if (isGmail) {
            const emailEl = qSel(gmailSelectors, 'sender_email_badge', '.gD');
            if (emailEl) leadData.email = emailEl.getAttribute('email') || leadData.email;
          }
          dlog('[Brevmont] Contact name updated to:', name);
        }
      }, 3000);
    }

    // ===== SPA OBSERVER for Facebook/Instagram — re-inject pill if DOM rebuilds =====
    if (isFacebook || isInstagram) {
      const target = document.querySelector('[role="main"]') || document.querySelector('[class*="x1n2onr6"]') || document.body;
      const spaObserver = new MutationObserver(() => {
        // If Facebook/Instagram SPA navigation destroyed the pill, re-inject it
        if (!document.getElementById('brevmont-pill') && !document.getElementById('brevmont-host')) {
          const container = document.querySelector('[role="main"], [data-testid="conversation"], [class*="messages"], [class*="messenger"], [class*="direct"]');
          if (container) {
            dlog('[Brevmont] SPA re-injection: pill was removed, re-creating');
            pill = document.createElement('div');
            pill.id = 'brevmont-pill';
            pill.textContent = 'BM';
            Object.assign(pill.style, {
              position:'fixed', zIndex:'9999',
              background:'#0D6E6E', color:'#fff', padding:'5px 8px', borderRadius:'6px',
              fontSize:'11px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'pointer',
              boxShadow:'0 2px 8px rgba(13,110,110,0.3)', letterSpacing:'0.5px', opacity:'0.85',
              transition:'opacity 0.15s, background 0.15s', userSelect:'none',
              whiteSpace:'nowrap', willChange:'opacity'
            });
            pill.onclick = () => { sidebarOpen ? closeSidebar() : openSidebar(); };
            pill.onmouseenter = () => { if(pill) { pill.style.opacity = '1'; pill.textContent = 'Brevmont'; } };
            pill.onmouseleave = () => { if(pill) { pill.style.opacity = '0.85'; pill.textContent = 'BM'; } };
            document.documentElement.appendChild(pill);
            updatePillPosition();
          }
        }
      });
      addObserver(spaObserver, target, { childList: true, subtree: true });
      // No timeout — keep watching for SPA navigation for the life of the page
    }

    // ===== VinSolutions SPA navigation observer =====
    if (isVinSolutions) {
      let lastVinUrl = window.location.href;
      let spaRescanTimer: ReturnType<typeof setTimeout> | null = null;
      const vinUrlObserver = new MutationObserver(() => {
        if (window.location.href !== lastVinUrl) {
          lastVinUrl = window.location.href;
          const existing = document.getElementById('brevmont-host');
          if (existing) existing.remove();
          const marker = document.getElementById('brevmont-sidebar');
          if (marker) marker.remove();
          sidebarRoot = null; sidebarOpen = false;
          // Show pill again after SPA navigation — user clicks to reopen
          if (pill) pill.style.display = 'block';

          // BUG 1 FIX: Clear stale customer data immediately on SPA navigation
          leadData = null;
          lastScannedName = '';
          browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
          updateSidebar();

          // Delayed rescan with validation — wait 1500ms for iframes to settle
          if (spaRescanTimer) clearTimeout(spaRescanTimer);
          spaRescanTimer = setTimeout(() => {
            validatedScan(0);
          }, 1500);
        }
      });
      addObserver(vinUrlObserver, document.body, { childList: true, subtree: true });

      // Validated scan: checks that detected name actually appears in visible page text
      // Retries up to 5 times with 500ms delay if validation fails
      function validatedScan(attempt: number) {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) {
          if (attempt < 5) setTimeout(() => validatedScan(attempt + 1), 500);
          return;
        }
        const s = scanText(dashText);
        if (!s.vehicle) {
          const allText = gatherAllText();
          s.vehicle = extractVehicle(allText) || null;
        }
        // Validate: customerName must appear somewhere in the visible page text
        if (s.customerName) {
          const pageText = document.body?.innerText || '';
          if (!pageText.includes(s.customerName)) {
            // Name not found in visible text — stale data, retry
            if (attempt < 5) setTimeout(() => validatedScan(attempt + 1), 500);
            return;
          }
          leadData = s;
          lastScannedName = s.customerName;
          browser.storage.local.set({ brevmont_lead: s, brevmont_lead_time: Date.now() });
          if (s.vehicle) browser.storage.local.set({ brevmont_vehicle_info: s.vehicle, brevmont_vehicle_info_time: Date.now() });
          updateSidebar();
        } else if (attempt < 5) {
          setTimeout(() => validatedScan(attempt + 1), 500);
        }
      }
    }

    // ===== PENDING NOTES BADGE (VinSolutions only) =====
    let pendingNotes: any[] = [];
    let pendingBadge: HTMLElement | null = null;
    let pendingPanel: HTMLElement | null = null;

    function refreshPendingBadge() {
      if (!isVinSolutions) return;
      safeSend({ type: 'GET_PENDING_NOTES' }).then((resp: any) => {
        pendingNotes = resp?.notes || [];
        if (pendingNotes.length > 0) {
          if (!pendingBadge) {
            pendingBadge = document.createElement('div');
            pendingBadge.id = 'brevmont-pending-badge';
            Object.assign(pendingBadge.style, { position:'fixed', bottom:'16px', right:'16px', zIndex:'9997', background:'#0D6E6E', color:'#fff', padding:'8px 14px', borderRadius:'20px', fontSize:'12px', fontWeight:'600', fontFamily:'system-ui,sans-serif', cursor:'pointer', boxShadow:'0 2px 12px rgba(13,110,110,0.4)', transition:'transform .15s' });
            pendingBadge.onmouseenter = () => { if (pendingBadge) pendingBadge.style.transform = 'scale(1.05)'; };
            pendingBadge.onmouseleave = () => { if (pendingBadge) pendingBadge.style.transform = 'scale(1)'; };
            pendingBadge.onclick = () => togglePendingPanel();
            document.body.appendChild(pendingBadge);
          }
          pendingBadge.textContent = `${pendingNotes.length} note${pendingNotes.length > 1 ? 's' : ''} to log`;
          pendingBadge.style.display = 'block';
        } else if (pendingBadge) {
          pendingBadge.style.display = 'none';
        }
      }).catch(() => {});
    }

    function togglePendingPanel() {
      if (pendingPanel) { pendingPanel.remove(); pendingPanel = null; return; }
      pendingPanel = document.createElement('div');
      Object.assign(pendingPanel.style, { position:'fixed', bottom:'56px', right:'16px', width:'320px', maxHeight:'400px', zIndex:'9997', background:'#fff', borderRadius:'12px', border:'1px solid #e2e8f0', boxShadow:'0 8px 32px rgba(0,0,0,0.15)', fontFamily:'system-ui,sans-serif', overflow:'hidden', display:'flex', flexDirection:'column' });

      let html = '<div style="padding:12px 16px;border-bottom:1px solid #e8eaed;font-size:13px;font-weight:700;color:#1a202c;display:flex;justify-content:space-between;align-items:center"><span>Pending Notes</span><span id="brevmont-pn-close" style="cursor:pointer;color:#94a3b8;font-size:18px">&times;</span></div>';
      html += '<div style="overflow-y:auto;flex:1;padding:8px">';

      if (pendingNotes.length === 0) {
        html += '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:20px">No pending notes</div>';
      } else {
        for (const note of pendingNotes) {
          const preview = (note.note_text || '').slice(0, 80) + ((note.note_text || '').length > 80 ? '...' : '');
          const time = new Date(note.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
          html += `<div class="brevmont-pn-card" data-id="${note.id}" data-text="${esc(note.note_text)}" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:6px">`;
          html += `<div style="font-size:12px;font-weight:600;color:#1a202c">${esc(note.customer_name || 'Unknown customer')}</div>`;
          html += `<div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4">${esc(preview)}</div>`;
          html += `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${time}</div>`;
          html += `<div style="display:flex;gap:6px;margin-top:6px">`;
          html += `<button class="brevmont-pn-log" data-id="${note.id}" style="padding:4px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Log It</button>`;
          html += `<button class="brevmont-pn-dismiss" data-id="${note.id}" style="padding:4px 12px;background:transparent;color:#94a3b8;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit">Dismiss</button>`;
          html += `</div></div>`;
        }
      }
      html += '</div>';
      pendingPanel.innerHTML = html;
      document.body.appendChild(pendingPanel);

      // Close button
      pendingPanel.querySelector('#brevmont-pn-close')?.addEventListener('click', () => { if (pendingPanel) { pendingPanel.remove(); pendingPanel = null; } });

      // Log It buttons
      pendingPanel.querySelectorAll('.brevmont-pn-log').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          const card = (btn as HTMLElement).closest('.brevmont-pn-card') as HTMLElement;
          const noteText = card?.dataset.text || '';
          (btn as HTMLElement).textContent = 'Pasting...';
          const statusEl = document.createElement('span');
          try {
            await pasteIntoCRM(noteText, statusEl);
            try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id, status: 'logged' } }); } catch(e) {}
            // Show confirmation before removing
            (btn as HTMLElement).textContent = '';
            const confirm = document.createElement('span');
            confirm.textContent = 'Note logged to your CRM';
            confirm.style.cssText = 'color:#16a34a;font-size:11px;font-weight:600;';
            (btn as HTMLElement).replaceWith(confirm);
            setTimeout(() => { card?.remove(); refreshPendingBadge(); }, 2000);
          } catch(e: any) {
            (btn as HTMLElement).textContent = 'Failed';
            (btn as HTMLElement).style.background = '#B91C1C';
            const errMsg = document.createElement('span');
            errMsg.textContent = e.message || 'Error logging note';
            errMsg.style.cssText = 'color:#B91C1C;font-size:10px;display:block;margin-top:4px;';
            card?.appendChild(errMsg);
            setTimeout(() => { (btn as HTMLElement).textContent = 'Log It'; (btn as HTMLElement).style.background = '#16a34a'; errMsg.remove(); }, 3000);
          }
        });
      });

      // Dismiss buttons
      pendingPanel.querySelectorAll('.brevmont-pn-dismiss').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          const card = (btn as HTMLElement).closest('.brevmont-pn-card') as HTMLElement;
          try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id, status: 'dismissed' } }); } catch(e) {}
          card?.remove();
          refreshPendingBadge();
        });
      });
    }

    // Poll pending notes every 30 seconds on VinSolutions
    if (isVinSolutions) {
      setTimeout(refreshPendingBadge, 5000); // first check after 5s
      addInterval(refreshPendingBadge, 30000);
    }

    // ===== INLINE MIC =====
    // Each mic instance gets its own isListening + recognition so they don't interfere
    function attachInlineMic(shadow: ShadowRoot, inputEl: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { micBtn.style.display = 'none'; return; }
      let isListening = false;
      let recognition: any = null;
      let fullTranscript = '';

      function cleanupRecognition() {
        isListening = false;
        micBtn.classList.remove('mic-active');
        if (recognition) {
          try { recognition.onend = null; recognition.onerror = null; recognition.onresult = null; } catch(e) {}
          try { recognition.abort(); } catch(e) {}
          recognition = null;
        }
        dlog('[Brevmont] Mic stopped and cleaned up');
      }

      micBtn.onclick = () => {
        if (isListening) {
          // STOP — finalize transcript, tear down completely
          dlog('[Brevmont] Mic stopping (user click)');
          cleanupRecognition();
          return;
        }

        // STOP any previous zombie recognition before starting fresh
        if (recognition) {
          dlog('[Brevmont] Tearing down previous mic session before starting new one');
          cleanupRecognition();
        }

        // START
        dlog('[Brevmont] Mic starting...');
        try {
          recognition = new SR();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          recognition.maxAlternatives = 1;
          fullTranscript = inputEl.value; // preserve existing text

          recognition.onresult = (e: any) => {
            // Only process NEW results starting from resultIndex
            for (let i = e.resultIndex; i < e.results.length; i++) {
              if (e.results[i].isFinal) {
                fullTranscript += e.results[i][0].transcript + ' ';
              }
            }
            // Display: all final text + current interim
            let display = fullTranscript;
            for (let i = 0; i < e.results.length; i++) {
              if (!e.results[i].isFinal) display += e.results[i][0].transcript;
            }
            inputEl.value = display;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'aborted') return; // normal stop, ignore
            dlog('[Brevmont] Mic error:', e.error);
            logError('VOICE_ERROR', `Speech recognition: ${e.error}`, `platform=${PLATFORM}`);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
              showToast(shadow, 'Mic permission denied. Enable in Chrome site settings.');
            } else if (e.error === 'audio-capture') {
              showToast(shadow, 'Mic in use by another tab. Close other tabs and try again.');
            } else {
              showToast(shadow, 'Mic error. Type your message.');
            }
            cleanupRecognition();
          };

          // Auto-restart on silence instead of stopping
          recognition.onend = () => {
            if (isListening) {
              dlog('[Brevmont] Mic auto-restarting after silence');
              try { recognition.start(); } catch(e) {
                dlog('[Brevmont] Mic auto-restart failed, cleaning up');
                cleanupRecognition();
              }
            }
          };

          recognition.start();
          isListening = true;
          micBtn.classList.add('mic-active');
          dlog('[Brevmont] Mic started successfully');
        } catch(e: any) {
          dlog('[Brevmont] Mic start failed:', e.message);
          cleanupRecognition();
          if (e.message?.includes('not-allowed') || e.name === 'NotAllowedError') {
            showToast(shadow, 'Mic permission denied. Enable in Chrome site settings.');
          } else {
            showToast(shadow, 'Voice not available. Type your message.');
          }
        }
      };
    }

    // ===== IMAGE COMPRESSION for Context Reply =====
    function compressImage(base64: string, maxLongEdge: number = 1568, quality: number = 0.85): Promise<string> {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const longEdge = Math.max(img.width, img.height);
          const ratio = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Progressive quality reduction to stay under 5MB
          let result = canvas.toDataURL('image/jpeg', quality);
          let q = quality;
          while (result.length > 5 * 1024 * 1024 * 1.37 && q > 0.3) {
            q -= 0.1;
            result = canvas.toDataURL('image/jpeg', q);
          }
          dlog(`[Brevmont] Image compressed: ${img.width}x${img.height} → ${canvas.width}x${canvas.height}, quality=${q.toFixed(1)}, size=${(result.length / 1024).toFixed(0)}KB`);
          resolve(result);
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
      });
    }

    function showToast(shadow: ShadowRoot, msg: string) {
      const existing = shadow.getElementById('brevmont-toast'); if (existing) existing.remove();
      const toast = document.createElement('div'); toast.id = 'brevmont-toast'; toast.textContent = msg;
      Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#1a202c', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'11px', fontWeight:'500', zIndex:'99', opacity:'1', transition:'opacity 0.3s' });
      shadow.getElementById('o8')?.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // ===== SIDEBAR =====
    async function openSidebar() {
      try { const syncCheck = await browser.storage.sync.get(['profile_onboarded', 'dealer_token']); const localCheck = await browser.storage.local.get(['profile_onboarded', 'dealer_token']); if (!(syncCheck.profile_onboarded || localCheck.profile_onboarded || syncCheck.dealer_token || localCheck.dealer_token)) { browser.runtime.sendMessage({ type: 'OPEN_ONBOARDING' }); return; } } catch(e: any) { logError('STORAGE_ERROR', e?.message || 'Storage onboarding check failed', 'pill_click'); }
      if (sidebarRoot) { sidebarRoot.style.display = 'block'; sidebarOpen = true; if (pill) pill.style.display = 'none'; updateSidebarPosition(); pushContent(true); return; }
      if (document.getElementById('brevmont-host')) return;

      await getTier();

      const host = document.createElement('div');
      host.id = 'brevmont-host';
      let w = getSidebarWidth();
      // Gmail: mount inside left nav when possible (product = in-page sidebar, not Chrome Side Panel).
      // Fallback: fixed strip on left edge if navigation DOM is not ready yet.
      if (isGmail) {
        /* styles applied in mount step after shadow root is built */
      } else if (isLinkedIn) {
        // LinkedIn: right side, below nav bar, card-style
        Object.assign(host.style, { position:'fixed', top:'72px', right:'8px', width: '280px', height:'calc(100vh - 82px)', maxHeight:'calc(100vh - 82px)', zIndex:'9999', overflow:'hidden', borderRadius:'8px', border:'1px solid #e0e0e0', boxShadow:'0 0 0 1px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)', background:'#fff' });
      } else if (!isVinSolutions) {
        // Cross-platform compact: right side, auto height
        Object.assign(host.style, { position:'fixed', top:'0', right:'0', width: w, height:'auto', maxHeight:'100vh', zIndex:'9999' });
      } else {
        // VinSolutions: fixed-width sidebar, right-aligned to the panel seam.
        // Height is content-driven (idle = tight fit to TCPA footer, grows as
        // outputs stream in). The CRM panel height and 'calc(100vh - 200px)'
        // act as the expansion CEILING, not the forced height — prior behavior
        // reserved ~378px of empty whitespace below the TCPA line when no
        // generation was active. Inner #o8 already has height:auto + flex
        // column layout with .outputs :empty/:not(:empty) sizing rules, so
        // switching the host to height:auto lets that layout actually take
        // effect. Overflow beyond max-height is handled by .outputs having
        // overflow-y:auto.
        const seam = findPanelSeamX();
        const seamX = seam ? seam.seamX : 640;
        const panelTop = seam ? seam.panelTop : 186;
        const sidebarWidth = 340;
        const panelHeightPx = (seam ? seam.panelHeight : 758);
        Object.assign(host.style, {
          position:'fixed',
          left: (seamX - sidebarWidth) + 'px',
          top: panelTop + 'px',
          margin:'0', padding:'0',
          width: sidebarWidth + 'px',
          height: 'auto',
          maxHeight: `min(calc(100vh - 200px), ${panelHeightPx}px)`,
          zIndex:'9999',
          boxShadow:'2px 0 12px rgba(0,0,0,0.15)',
          overflow:'hidden',
          background:'#fff',
          borderRadius:'0 0 8px 0'
        });
      }

      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = getCSS(w); shadow.appendChild(style);
      const container = document.createElement('div'); container.id = 'o8'; container.innerHTML = getHTML(); shadow.appendChild(container);

      /** Gmail: full-height sidebar appended to document.body.
       *  Bypasses Gmail's stacking contexts (translateZ / will-change).
       *  position:fixed + body append = always on top. */
      function applyGmailFixedLayout(): void {
        Object.assign(host.style, {
          position: 'fixed',
          top: '555px',
          left: '60px',
          width: '256px',
          maxHeight: '600px',
          zIndex: '2147483647',
          overflowY: 'auto',
          overflow: 'hidden',
          background: '#fff',
          borderRight: '1px solid #dadce0',
          boxShadow: '2px 0 8px rgba(60,64,67,0.18)',
          borderRadius: '0',
        });
      }

      if (isGmail) {
        applyGmailFixedLayout();
        document.body.appendChild(host);
      } else {
        document.documentElement.appendChild(host);
      }
      const marker = document.createElement('div'); marker.id = 'brevmont-sidebar'; marker.style.display = 'none'; document.documentElement.appendChild(marker);

      sidebarRoot = host; sidebarOpen = true;
      if (pill) pill.style.display = 'none';
      pushContent(true);

      const s = shadow;

      // Legacy-attribution banner: reps installed before the rep-token path
      // shipped are identified by rep_name string only. Offer them a one-click
      // upgrade link (opens dashboard rep-token install page). Dismissable per
      // browser — we stash dismissal in local so it survives SW restarts but
      // not reinstalls. Non-blocking: everything else in the sidebar keeps
      // working whether the banner renders or not.
      (async () => {
        try {
          const [syncData, localData] = await Promise.all([
            browser.storage.sync.get(['rep_name', 'rep_auth_token']),
            browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token', 'brevmont_rep_banner_dismissed']),
          ]);
          const hasRepToken = !!(syncData.rep_auth_token || localData.rep_auth_token || localData.brevmont_rep_auth_token);
          const hasRepName = !!(syncData.rep_name);
          const dismissed = !!localData.brevmont_rep_banner_dismissed;
          if (hasRepToken || !hasRepName || dismissed) return;
          const banner = document.createElement('div');
          banner.id = 'o8-rep-token-banner';
          banner.style.cssText = 'margin:8px;padding:10px 12px;border-radius:8px;background:#FEF3C7;border:1px solid #F59E0B;color:#78350F;font-size:12px;line-height:1.4;display:flex;gap:8px;align-items:flex-start;font-family:Inter,system-ui,sans-serif;';
          banner.innerHTML = '<div style="flex:1"><div style="font-weight:700;margin-bottom:2px">Legacy attribution</div><div>You are being tracked by name only. <a id="o8-rep-token-link" href="#" style="color:#0D6E6E;text-decoration:underline;font-weight:600">Click here for accurate tracking.</a></div></div><button id="o8-rep-token-dismiss" aria-label="Dismiss" style="background:transparent;border:none;color:#78350F;cursor:pointer;font-size:16px;line-height:1;padding:0 2px">&times;</button>';
          const container = s.getElementById('o8');
          if (container) container.insertBefore(banner, container.firstChild);
          const link = s.getElementById('o8-rep-token-link');
          if (link) link.addEventListener('click', (ev) => {
            ev.preventDefault();
            try {
              browser.runtime.sendMessage({ type: 'OPEN_URL', payload: { url: 'https://app.brevmont.com/rep/install-token' } }).catch(() => {
                window.open('https://app.brevmont.com/rep/install-token', '_blank');
              });
            } catch {
              window.open('https://app.brevmont.com/rep/install-token', '_blank');
            }
          });
          const dismissBtn = s.getElementById('o8-rep-token-dismiss');
          if (dismissBtn) dismissBtn.addEventListener('click', () => {
            banner.remove();
            try { browser.storage.local.set({ brevmont_rep_banner_dismissed: true }); } catch {}
          });
        } catch {}
      })();

      // Close
      s.getElementById('o8-close')!.onclick = closeSidebar;

      // Version badge — pulls live from chrome.runtime.getManifest() so
      // the founder always sees the actual loaded version, not a hardcoded
      // string. If two extensions are loaded, this confirms which one is
      // attached to the page.
      try {
        const vb = s.getElementById('o8-version-badge');
        if (vb) {
          const v = chrome?.runtime?.getManifest?.()?.version || 'unknown';
          vb.textContent = `v${v}`;
        }
      } catch {}

      // Output chips — dual role (2026-04-19 tabbed-outputs refactor):
      //   1. Pre-generation (no card exists for this type): toggle `.on` =
      //      include-in-next-generation. Same as the legacy behavior.
      //   2. Post-generation (a card already exists for this type): tab-
      //      switch to that card without regenerating. Does NOT re-toggle
      //      `.on` — the user just wants to view that output.
      s.querySelectorAll('.chip').forEach(c => {
        c.addEventListener('click', () => {
          const type = c.getAttribute('data-type') || '';
          const hasCards = s.querySelectorAll('.out-card').length > 0;
          if (hasCards) {
            setActiveOutputTab(s, type);
          } else {
            c.classList.toggle('on');
          }
        });
      });

      // Generate
      s.getElementById('o8-generate')!.onclick = () => doGenerate(s);
      const mainInput = s.getElementById('o8-input') as HTMLTextAreaElement;
      mainInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(s); } });

      // Main mic
      attachInlineMic(s, mainInput, s.getElementById('o8-mic')!);

      // Mark Outcome handler
      if (isVinSolutions) {
        const outcomeSection = s.getElementById('o8-outcome-section');
        const outcomeBtn = s.getElementById('o8-outcome-btn');
        const outcomeSelect = s.getElementById('o8-outcome-select') as HTMLSelectElement | null;
        const outcomeStatus = s.getElementById('o8-outcome-status');

        // Show outcome section when customer name is loaded
        const showOutcomeIfReady = () => {
          const nameEl = s.getElementById('o8-name');
          if (nameEl && outcomeSection && nameEl.textContent && !nameEl.textContent.includes('Open a customer')) {
            outcomeSection.style.display = 'block';
          }
        };
        // Check periodically (customer card updates async)
        const outcomeInterval = setInterval(showOutcomeIfReady, 2000);
        setTimeout(() => clearInterval(outcomeInterval), 60000); // stop checking after 1 min

        if (outcomeBtn && outcomeSelect) {
          outcomeBtn.addEventListener('click', async () => {
            const outcome = outcomeSelect.value;
            if (!outcome) {
              if (outcomeStatus) outcomeStatus.textContent = 'Please select an outcome';
              return;
            }

            // Confirmation for irreversible outcomes
            if ((outcome === 'vehicle_sold' || outcome === 'deal_lost') && !outcomeBtn.dataset.confirmed) {
              outcomeBtn.textContent = 'Confirm?';
              outcomeBtn.style.background = outcome === 'vehicle_sold' ? '#FF9500' : '#FF3B30';
              outcomeBtn.dataset.confirmed = 'true';
              setTimeout(() => {
                outcomeBtn.textContent = 'Mark Outcome';
                outcomeBtn.style.background = '#34C759';
                delete outcomeBtn.dataset.confirmed;
              }, 3000);
              return;
            }

            delete outcomeBtn.dataset.confirmed;
            outcomeBtn.textContent = 'Saving...';
            outcomeBtn.setAttribute('disabled', 'true');

            const nameEl = s.getElementById('o8-name');
            const customerName = nameEl?.textContent?.trim() || '';

            try {
              const resp = await safeSend({
                type: 'MARK_OUTCOME',
                payload: { customer_name: customerName, outcome }
              });
              if (resp?.error) {
                if (outcomeStatus) outcomeStatus.textContent = resp.error;
                outcomeBtn.textContent = 'Mark Outcome';
                outcomeBtn.style.background = '#34C759';
              } else {
                outcomeBtn.textContent = '✓ Saved';
                outcomeBtn.style.background = '#10B981';
                if (outcomeStatus) outcomeStatus.textContent = `Marked as ${outcome.replace(/_/g, ' ')}`;
                outcomeSelect.value = '';
                setTimeout(() => {
                  outcomeBtn.textContent = 'Mark Outcome';
                  outcomeBtn.style.background = '#34C759';
                  outcomeBtn.removeAttribute('disabled');
                }, 3000);
              }
            } catch (e: any) {
              if (outcomeStatus) outcomeStatus.textContent = e.message || 'Failed to save';
              outcomeBtn.textContent = 'Mark Outcome';
              outcomeBtn.style.background = '#34C759';
            }
            outcomeBtn.removeAttribute('disabled');
          });
        }
      }

      const settingsPanel = s.getElementById('o8-settings-panel');
      const settingsBack = s.getElementById('o8-settings-back');
      if (settingsBack) {
        settingsBack.onclick = () => { settingsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; };
      }

      // Settings tone/goal radio buttons — all unlocked
      s.querySelectorAll('input[name="brevmont-tone"]').forEach(radio => {
        radio.addEventListener('change', () => { browser.storage.local.set({ brevmont_tone: (radio as HTMLInputElement).value }); });
      });
      s.querySelectorAll('input[name="brevmont-goal"]').forEach(radio => {
        radio.addEventListener('change', () => { browser.storage.local.set({ brevmont_goal: (radio as HTMLInputElement).value }); });
      });
      browser.storage.local.get(['brevmont_tone', 'brevmont_goal']).then(r => {
        if (r.brevmont_tone) { const el = s.querySelector(`input[name="brevmont-tone"][value="${r.brevmont_tone}"]`) as HTMLInputElement; if (el) el.checked = true; }
        if (r.brevmont_goal) { const el = s.querySelector(`input[name="brevmont-goal"][value="${r.brevmont_goal}"]`) as HTMLInputElement; if (el) el.checked = true; }
      });

      // Tools panel
      const toolsPanel = s.getElementById('o8-tools-panel');
      const toolsBack = s.getElementById('o8-tools-back');
      const openTools = () => { s.getElementById('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'flex'; };
      const toolsBtnInline = s.getElementById('o8-tools-btn-inline');
      if (toolsBtnInline) toolsBtnInline.onclick = openTools;
      if (toolsBack) { toolsBack.onclick = () => { toolsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; }; }

      // Settings
      const openSettings = () => { s.getElementById('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'none'; if (settingsPanel) settingsPanel.style.display = 'flex'; };
      const settingsBtnInline = s.getElementById('o8-settings-btn-inline');
      if (settingsBtnInline) settingsBtnInline.onclick = openSettings;

      // My Stats panel
      const statsPanel = s.getElementById('o8-stats-panel');
      const statsBack = s.getElementById('o8-stats-back');
      const statsContent = s.getElementById('o8-stats-content');
      const openStats = async () => {
        s.getElementById('o8-quick')!.style.display = 'none';
        if (toolsPanel) toolsPanel.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (statsPanel) statsPanel.style.display = 'flex';
        if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>';
        try {
          const syncSettings = await browser.storage.sync.get(['dealer_token', 'rep_name']);
          const localSettings = await browser.storage.local.get(['dealer_token', 'rep_name']);
          const dealerToken = syncSettings.dealer_token || localSettings.dealer_token;
          const repName = syncSettings.rep_name || localSettings.rep_name;
          if (!dealerToken || !repName) {
            if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Set your rep name in Settings first.</div>';
            return;
          }
          const resp = await fetch(`https://api.brevmont.com/v1/rep/stats?rep_name=${encodeURIComponent(repName)}`, {
            headers: { 'Authorization': `Bearer ${dealerToken}` }
          });
          if (!resp.ok) throw new Error(`Stats API returned ${resp.status}`);
          const d = await resp.json();
          if (statsContent) statsContent.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
              <div style="background:#F0FDF4;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#166534;">${d.total}</div>
                <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Total (30d)</div>
              </div>
              <div style="background:#EFF6FF;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#1E40AF;">${d.today_count}</div>
                <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Today</div>
              </div>
              <div style="background:#FFF7ED;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#C2410C;">${d.streak}${d.streak >= 7 ? ' ⚡' : ''}</div>
                <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Day Streak</div>
              </div>
              <div style="background:#F5F3FF;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#6D28D9;">#${d.rank}</div>
                <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">of ${d.total_reps} reps</div>
              </div>
            </div>
            <div style="background:#F8FAFC;border-radius:8px;padding:10px;margin-bottom:8px;">
              <div style="font-size:10px;color:#94A3B8;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Breakdown</div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#1C1C1E;margin-bottom:4px;"><span>Texts</span><strong>${d.texts}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#1C1C1E;margin-bottom:4px;"><span>Emails</span><strong>${d.emails}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#1C1C1E;"><span>CRM Notes</span><strong>${d.crm_notes}</strong></div>
            </div>
            <div style="background:#F8FAFC;border-radius:8px;padding:10px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#1C1C1E;margin-bottom:4px;"><span>Unique Customers</span><strong>${d.unique_customers}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#1C1C1E;"><span>Time Saved</span><strong>${Math.round(d.estimated_time_saved_minutes / 60 * 10) / 10}h</strong></div>
            </div>`;
        } catch (e) {
          if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#EF4444;font-size:12px;padding:24px;">Could not load stats. Try again later.</div>';
        }
      };
      const statsBtnInline = s.getElementById('o8-stats-btn-inline');
      if (statsBtnInline) statsBtnInline.onclick = openStats;
      if (statsBack) { statsBack.onclick = () => { statsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; }; }

      // Lead Capture panel
      const leadPanel = s.getElementById('o8-lead-panel');
      const leadBack = s.getElementById('o8-lead-back');
      const leadResult = s.getElementById('o8-lead-result');
      const openLead = () => { s.getElementById('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'none'; if (settingsPanel) settingsPanel.style.display = 'none'; if (leadPanel) leadPanel.style.display = 'flex'; };
      const closeLead = () => { if (leadPanel) leadPanel.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; };
      const leadBtn = s.getElementById('o8-lead-btn');
      if (leadBtn) leadBtn.onclick = openLead;
      if (leadBack) leadBack.onclick = closeLead;

      // Lead tab switching
      s.querySelectorAll('.lead-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          s.querySelectorAll('.lead-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          ['lead-scan', 'lead-voice', 'lead-paste'].forEach(id => { const el = s.getElementById(id); if (el) el.style.display = 'none'; });
          const tab = (btn as HTMLElement).dataset.ltab;
          const target = s.getElementById('lead-' + tab);
          if (target) target.style.display = 'block';
          if (leadResult) leadResult.style.display = 'none'; // hide result when switching tabs
        });
      });

      // Lead voice mic
      const leadVoiceInput = s.getElementById('o8-lead-voice-input') as HTMLTextAreaElement;
      const leadVoiceMic = s.getElementById('o8-lead-voice-mic');
      if (leadVoiceInput && leadVoiceMic) attachInlineMic(s, leadVoiceInput, leadVoiceMic);

      // Context extraction per platform
      function getLeadContext(): string {
        if (isFacebook) {
          const main = document.querySelector('[role="main"]');
          if (main) return main.innerText.slice(0, 1500);
          const conv = document.querySelector('[data-pagelet*="MWConversation"]');
          if (conv) return (conv as HTMLElement).innerText.slice(0, 1500);
          return document.body.innerText.slice(0, 1500);
        }
        if (isLinkedIn) {
          const thread = document.querySelector('.msg-s-message-list-content, [class*="msg-thread"], [class*="message-list"], .msg-conversations-container__thread-view, [class*="scaffold-layout__detail"]');
          if (thread) return (thread as HTMLElement).innerText.slice(0, 2000);
          // Fallback: grab the right panel (conversation area)
          const rightPanel = document.querySelector('[class*="msg-conversation-card"], [class*="msg-s-event-listitem"], main');
          if (rightPanel) return (rightPanel as HTMLElement).innerText.slice(0, 2000);
          return document.body.innerText.slice(0, 1500);
        }
        if (isGmail) {
          const msg = document.querySelector('.h7, [role="list"], .a3s');
          if (msg) return (msg as HTMLElement).innerText.slice(0, 2000);
          return document.body.innerText.slice(0, 1500);
        }
        if (isInstagram) {
          const thread = document.querySelector('[role="main"]');
          if (thread) return (thread as HTMLElement).innerText.slice(0, 1500);
        }
        return document.body.innerText.slice(0, 1500);
      }

      // ===== UNIVERSAL CONTACT NAME EXTRACTION (all platforms) =====
      function extractContactName(): string | null {
        if (isGmail) {
          // Gmail: sender name from email header elements
          const senderEl = qSel(gmailSelectors, 'sender_email_badge', '.gD');
          if (senderEl) {
            const name = (senderEl as HTMLElement).getAttribute('name')
              || (senderEl as HTMLElement).textContent?.trim()
              || null;
            if (name && name.length > 1 && name.length < 60) return name;
          }
          const goEl = document.querySelector('.go');
          if (goEl) {
            const name = (goEl as HTMLElement).textContent?.trim();
            if (name && name.length > 1 && name.length < 60) return name;
          }
          const namedEl = document.querySelector('[data-name]');
          if (namedEl) {
            const name = namedEl.getAttribute('data-name');
            if (name && name.length > 1 && name.length < 60) return name;
          }
          return null;
        }

        if (isFacebook) {
          // Messenger: conversation header shows contact name
          const headerSpan = document.querySelector('[data-testid="mwthreadlist-item-open"] span')
            || document.querySelector('div[role="main"] h2 span')
            || document.querySelector('div[role="banner"] a[role="link"] span');
          if (headerSpan) {
            const name = (headerSpan as HTMLElement).textContent?.trim();
            if (name && name.length > 1 && name.length < 50 && !name.includes('@')) return name;
          }
          const convoHeader = document.querySelector('[aria-label*="Conversation with"]');
          if (convoHeader) {
            const label = convoHeader.getAttribute('aria-label') || '';
            const match = label.match(/Conversation with (.+)/i);
            if (match && match[1].trim().length > 1) return match[1].trim();
          }
          // Fallback: title tag on messenger.com often contains the contact name
          if (window.location.hostname.includes('messenger.com')) {
            const title = document.title.replace(/ - .*$/, '').replace(/\(\d+\)\s*/, '').trim();
            if (title && title.length > 1 && title.length < 50 && title !== 'Messenger') return title;
          }
          return null;
        }

        if (isLinkedIn) {
          // LinkedIn: messaging header shows contact name
          const nameEl = document.querySelector('.msg-overlay-bubble-header__title')
            || document.querySelector('.msg-s-message-group__name')
            || document.querySelector('.msg-thread__link-to-profile')
            || document.querySelector('.msg-entity-lockup__entity-title')
            || document.querySelector('[class*="msg-overlay-conversation-bubble"] h2');
          if (nameEl) {
            const name = (nameEl as HTMLElement).textContent?.trim();
            if (name && name.length > 1 && name.length < 60) return name;
          }
          return null;
        }

        if (isInstagram) {
          // Instagram DMs: thread header
          const igHeader = document.querySelector('header h2')
            || document.querySelector('[role="heading"]');
          if (igHeader) {
            const name = (igHeader as HTMLElement).textContent?.trim();
            if (name && name.length > 1 && name.length < 50) return name;
          }
          return null;
        }

        return null;
      }

      // ===== INTELLIGENCE: DOM discovery telemetry =====
      // Captures page structure fingerprint once per page load to help
      // identify CRM layout changes and new selector opportunities.
      function captureDomDiscovery(): void {
        try {
          if (!isVinSolutions) return;
          // Only fire once per session per URL path
          const pageKey = `brevmont_dom_disc_${window.location.pathname}`;
          if ((window as any)[pageKey]) return;
          (window as any)[pageKey] = true;
          // Capture iframe sources + key element IDs
          const iframes = Array.from(document.querySelectorAll('iframe')).slice(0, 20).map(f => ({
            src: (f.src || '').slice(0, 200),
            id: f.id || null,
            name: f.name || null,
          }));
          const ids = Array.from(document.querySelectorAll('[id]')).slice(0, 50).map(el => ({
            id: el.id,
            tag: el.tagName.toLowerCase(),
          }));
          const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(f => ({
            action: (f.action || '').slice(0, 200),
            id: f.id || null,
            inputs: Array.from(f.querySelectorAll('input, textarea, select')).slice(0, 15).map(i => ({
              name: (i as HTMLInputElement).name || null,
              id: i.id || null,
              type: (i as HTMLInputElement).type || i.tagName.toLowerCase(),
            })),
          }));
          browser.runtime.sendMessage({
            type: 'TELEMETRY_DOM_DISCOVERY',
            payload: {
              url_path: window.location.pathname,
              page_title: document.title?.slice(0, 200) || '',
              platform: PLATFORM,
              iframes,
              ids,
              forms,
            }
          }).catch(() => {});
        } catch { /* never crash */ }
      }
      // Fire DOM discovery after a short delay to let CRM load
      setTimeout(captureDomDiscovery, 5000);

      // Parse lead from text
      async function parseLead(rawText: string, inputMethod: string) {
        // Show loading in all input tabs
        ['o8-scan-btn', 'o8-lead-voice-parse', 'o8-lead-paste-parse'].forEach(id => {
          const btn = s.getElementById(id) as HTMLButtonElement;
          if (btn) { btn.innerHTML = '<span class="gen-spinner"></span> Parsing…'; btn.disabled = true; }
        });
        try {
          const resp = await safeSend({ type: 'PARSE_LEAD', payload: { raw_text: rawText, platform: PLATFORM } });
          if (resp.error) { showToast(s, 'Parse failed: ' + resp.error); return; }
          const lead = resp.lead || resp;
          showLeadCard(lead, inputMethod);
        } catch(e: any) {
          logError('API_ERROR', e.message || 'Lead parse failed', `platform=${PLATFORM},method=safeSend`);
          showToast(s, 'Parse error: ' + e.message);
        } finally {
          ['o8-scan-btn', 'o8-lead-voice-parse', 'o8-lead-paste-parse'].forEach(id => {
            const btn = s.getElementById(id) as HTMLButtonElement;
            if (btn) { btn.innerHTML = id.includes('scan') ? 'Scan This Page' : 'Parse'; btn.disabled = false; }
          });
        }
      }

      // Render parsed lead card
      function showLeadCard(lead: any, inputMethod: string) {
        if (!leadResult) return;
        // Hide input tabs, show result
        ['lead-scan', 'lead-voice', 'lead-paste'].forEach(id => { const el = s.getElementById(id); if (el) el.style.display = 'none'; });
        leadResult.style.display = 'block';

        const fields = [
          { key: 'first_name', label: 'First Name' },
          { key: 'last_name', label: 'Last Name' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'vehicle_interest', label: 'Vehicle Interest' },
          { key: 'notes', label: 'Notes' }
        ];

        const isLocked = currentTier !== 'command' && currentTier !== 'group';
        const confidence = lead.confidence || 0;

        let html = `<div class="lead-confidence">${confidence}% confidence</div>`;
        for (const f of fields) {
          const val = lead[f.key] || '';
          html += `<div class="lead-field"><label>${f.label}</label><input class="lead-input ${val ? '' : 'empty'}" data-field="${f.key}" value="${esc(val)}" placeholder="${f.label}" /></div>`;
        }

        if (isLocked) {
          html += `<button class="lead-inject-btn locked" disabled>🔒 Inject to CRM</button>`;
          html += `<div class="lead-gate-msg">Lead Capture requires Command. Upgrade at brevmont.com</div>`;
        } else {
          html += `<button id="o8-lead-inject" class="lead-inject-btn">Inject to CRM</button>`;
        }
        html += `<button id="o8-lead-cancel" class="lead-cancel-btn">Cancel</button>`;

        leadResult.innerHTML = html;

        // Remove empty class on input
        leadResult.querySelectorAll('.lead-input').forEach(inp => {
          inp.addEventListener('input', function(this: HTMLInputElement) { this.classList.toggle('empty', !this.value); });
        });

        // Cancel button
        const cancelBtn = leadResult.querySelector('#o8-lead-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
          leadResult.style.display = 'none';
          const activeTab = s.querySelector('.lead-tab-btn.active') as HTMLElement;
          const tabId = activeTab?.dataset.ltab || 'scan';
          const target = s.getElementById('lead-' + tabId);
          if (target) target.style.display = 'block';
        });

        // Inject button (Command tier only)
        const injectBtn = leadResult.querySelector('#o8-lead-inject');
        if (injectBtn) {
          injectBtn.addEventListener('click', async () => {
            const data: any = {};
            leadResult.querySelectorAll('.lead-input').forEach((inp: any) => { data[inp.dataset.field] = inp.value; });

            if (!isVinSolutions) {
              // Save pending lead for later
              await browser.storage.local.set({ brevmont_pending_lead: data, brevmont_pending_lead_time: Date.now() });
              navigator.clipboard.writeText(`${data.first_name || ''} ${data.last_name || ''}\nPhone: ${data.phone || ''}\nEmail: ${data.email || ''}\nVehicle: ${data.vehicle_interest || ''}\nNotes: ${data.notes || ''}`);
              showToast(s, 'Lead saved. Open your CRM to inject.');
              closeLead();
              return;
            }

            // On VinSolutions — duplicate check
            if (data.phone) {
              const pageText = document.body.innerText || '';
              if (pageText.includes(data.phone)) {
                const confirmDiv = document.createElement('div');
                confirmDiv.style.cssText = 'padding:8px;background:#FEF08A;border:1px solid #FDE047;border-radius:6px;margin-top:8px;font-size:12px;text-align:center;';
                confirmDiv.innerHTML = `This number may already exist in your CRM.<br><button id="o8-lead-confirm-yes" style="padding:4px 12px;background:#0D6E6E;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin:4px">Inject Anyway</button><button id="o8-lead-confirm-no" style="padding:4px 12px;background:#fff;border:1px solid #E5E7EB;border-radius:4px;font-size:11px;cursor:pointer;margin:4px">Cancel</button>`;
                leadResult.appendChild(confirmDiv);
                confirmDiv.querySelector('#o8-lead-confirm-no')!.addEventListener('click', () => confirmDiv.remove());
                confirmDiv.querySelector('#o8-lead-confirm-yes')!.addEventListener('click', () => { confirmDiv.remove(); doVinSolutionsInject(data, inputMethod); });
                return;
              }
            }
            doVinSolutionsInject(data, inputMethod);
          });
        }
      }

      // VinSolutions Add Customer injection
      async function doVinSolutionsInject(data: any, inputMethod: string) {
        // Try to find Add Customer button
        const addCustSelectors = ['a[data-uname*="addCust"]', 'a[data-uname*="AddCust"]', 'button[title*="Add Customer"]', 'a[href*="AddCustomer"]', 'a[href*="addcustomer"]'];
        let addBtn: HTMLElement | null = null;
        for (const sel of addCustSelectors) { addBtn = document.querySelector(sel) as HTMLElement; if (addBtn) break; }
        if (!addBtn) {
          // Scan all clickable elements for "Add Customer" text
          for (const el of document.querySelectorAll('a, button, div[role="button"], span')) {
            if (el.textContent?.trim().includes('Add Customer') && (el as HTMLElement).offsetWidth > 0) { addBtn = el as HTMLElement; break; }
          }
        }

        if (!addBtn) {
          // Fallback — copy to clipboard
          const clipText = `${data.first_name || ''} ${data.last_name || ''}\nPhone: ${data.phone || ''}\nEmail: ${data.email || ''}\nVehicle: ${data.vehicle_interest || ''}\nNotes: ${data.notes || ''}`;
          navigator.clipboard.writeText(clipText);
          showToast(s, "Couldn't find Add Customer. Lead data copied to clipboard.");
          // Log anyway
          try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'LEAD_CAPTURED', platform: PLATFORM, customer: `${data.first_name || ''} ${data.last_name || ''}`.trim(), input_method: inputMethod, fields_populated: Object.values(data).filter(Boolean).length, tier: currentTier } }); } catch(e) {}
          closeLead();
          return;
        }

        addBtn.click();
        showToast(s, 'Opening Add Customer form…');

        // Wait for form to load, then inject
        setTimeout(async () => {
          // Search all iframes for form fields
          const docs: Document[] = [document];
          document.querySelectorAll('iframe').forEach(iframe => { try { const d = (iframe as HTMLIFrameElement).contentDocument; if (d) docs.push(d); } catch(e) {} });

          for (const doc of docs) {
            const firstNameField = doc.querySelector('input[name*="irstName"], input[name*="irst_name"], input[id*="irstName"], input[id*="firstName"]') as HTMLInputElement;
            const lastNameField = doc.querySelector('input[name*="astName"], input[name*="ast_name"], input[id*="astName"], input[id*="lastName"]') as HTMLInputElement;
            const phoneField = doc.querySelector('input[name*="hone"], input[id*="hone"], input[type="tel"]') as HTMLInputElement;
            const emailField = doc.querySelector('input[name*="mail"], input[id*="mail"], input[type="email"]') as HTMLInputElement;

            if (firstNameField || lastNameField || phoneField) {
              if (firstNameField && data.first_name) { firstNameField.focus(); safeInjectText(firstNameField, data.first_name); }
              if (lastNameField && data.last_name) { lastNameField.focus(); safeInjectText(lastNameField, data.last_name); }
              if (phoneField && data.phone) { phoneField.focus(); safeInjectText(phoneField, data.phone); }
              if (emailField && data.email) { emailField.focus(); safeInjectText(emailField, data.email); }
              showToast(s, 'Form filled. Review and click Save in your CRM.');

              // Log capture event
              try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'LEAD_CAPTURED', platform: PLATFORM, customer: `${data.first_name || ''} ${data.last_name || ''}`.trim(), input_method: inputMethod, fields_populated: Object.values(data).filter(Boolean).length, tier: currentTier } }); } catch(e) {}
              closeLead();
              return;
            }
          }

          // Form fields not found — fallback to clipboard
          const clipText = `${data.first_name || ''} ${data.last_name || ''}\nPhone: ${data.phone || ''}\nEmail: ${data.email || ''}\nVehicle: ${data.vehicle_interest || ''}\nNotes: ${data.notes || ''}`;
          navigator.clipboard.writeText(clipText);
          showToast(s, "Form opened but fields not found. Lead data copied to clipboard.");
          try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'LEAD_CAPTURED', platform: PLATFORM, customer: `${data.first_name || ''} ${data.last_name || ''}`.trim(), input_method: inputMethod, fields_populated: Object.values(data).filter(Boolean).length, tier: currentTier } }); } catch(e) {}
          closeLead();
        }, 1500);
      }

      // Scan button
      const scanBtn = s.getElementById('o8-scan-btn');
      if (scanBtn) scanBtn.onclick = () => parseLead(getLeadContext(), 'scan');

      // Voice parse button
      const voiceParseBtn = s.getElementById('o8-lead-voice-parse');
      if (voiceParseBtn) voiceParseBtn.onclick = () => {
        const input = (s.getElementById('o8-lead-voice-input') as HTMLTextAreaElement)?.value?.trim();
        if (input) parseLead(input, 'voice');
      };

      // Paste parse button
      const pasteParseBtn = s.getElementById('o8-lead-paste-parse');
      if (pasteParseBtn) pasteParseBtn.onclick = () => {
        const input = (s.getElementById('o8-lead-paste-input') as HTMLTextAreaElement)?.value?.trim();
        if (input) parseLead(input, 'paste');
      };

      // Check for pending lead on VinSolutions load
      if (isVinSolutions) {
        browser.storage.local.get(['brevmont_pending_lead', 'brevmont_pending_lead_time']).then(r => {
          if (r.brevmont_pending_lead && r.brevmont_pending_lead_time && (Date.now() - r.brevmont_pending_lead_time < 24 * 60 * 60 * 1000)) {
            const quickMode = s.getElementById('o8-quick');
            if (quickMode) {
              const banner = document.createElement('div');
              banner.className = 'lead-banner';
              banner.innerHTML = 'You have an uninjected lead. Tap to complete.';
              banner.onclick = () => {
                banner.remove();
                openLead();
                // Show the lead card with saved data
                showLeadCard(r.brevmont_pending_lead, 'saved');
              };
              quickMode.insertBefore(banner, quickMode.firstChild);
            }
          }
        });
      }

      s.querySelectorAll('.tool-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          s.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active'));
          s.querySelectorAll('.tool-content').forEach(c => (c as HTMLElement).style.display = 'none');
          btn.classList.add('active');
          s.getElementById('tool-' + (btn as HTMLElement).dataset.tool)!.style.display = 'block';
        });
      });

      // Coach
      const coachInput = s.getElementById('o8-coach-input') as HTMLTextAreaElement;
      const coachMic = s.getElementById('o8-coach-mic');
      if (coachInput && coachMic) attachInlineMic(s, coachInput, coachMic);
      s.querySelectorAll('.coach-chip').forEach(chip => { chip.addEventListener('click', () => { if (coachInput) coachInput.value = chip.textContent || ''; }); });
      const coachBtn = s.getElementById('o8-coach-btn');
      if (coachBtn) {
        coachBtn.addEventListener('click', async () => {
          const input = coachInput?.value.trim(); if (!input) return;
          coachBtn.textContent = 'Thinking...'; (coachBtn as any).disabled = true;
          try {
            const resp = await safeSend({ type: 'COACH_ME', payload: { situation: input, vehicleContext: leadData?.vehicle || '' } });
            const output = s.getElementById('o8-coach-output')!;
            output.innerHTML = resp.error ? '<div class="tool-result">' + esc(resp.error) + '</div>' : '<div class="tool-result"><strong>YOUR NEXT MOVE:</strong><br>' + esc(resp.coaching).replace(/\n/g, '<br>') + '</div>';
          } catch(e: any) { s.getElementById('o8-coach-output')!.innerHTML = '<div class="tool-result">' + esc(e.message) + '</div>'; }
          coachBtn.textContent = 'Coach Me'; (coachBtn as any).disabled = false;
        });
      }

      // Alerts
      const alertInput = s.getElementById('o8-alert-input') as HTMLInputElement;
      const alertMic = s.getElementById('o8-alert-mic');
      if (alertInput && alertMic) attachInlineMic(s, alertInput, alertMic);
      const alertBtn = s.getElementById('o8-alert-btn');
      if (alertBtn) {
        alertBtn.addEventListener('click', async () => {
          const input = alertInput?.value.trim(); if (!input) return;
          try { await safeSend({ type: 'SET_ALERT', payload: { task: input, alertTime: parseAlertTime(input) } }); } catch(e: any) { if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); } return; }
          alertInput.value = ''; loadAlerts(s);
        });
      }

      // Command
      const cmdInput = s.getElementById('o8-cmd-input') as HTMLTextAreaElement;
      const cmdMic = s.getElementById('o8-cmd-mic');
      if (cmdInput && cmdMic) attachInlineMic(s, cmdInput, cmdMic);
      const cmdExec = s.getElementById('o8-cmd-execute');
      if (cmdExec) {
        cmdExec.addEventListener('click', async () => {
          const input = cmdInput?.value.trim(); if (!input) return;
          cmdExec.textContent = 'Processing...'; (cmdExec as any).disabled = true;
          const sa = s.getElementById('o8-cmd-status')!; sa.innerHTML = '';
          try {
            const resp = await safeSend({ type: 'EXECUTE_COMMAND', payload: { command: input, currentUrl: window.location.href, vehicleContext: leadData?.vehicle || '' } });
            if (resp.error) sa.innerHTML = '<div class="tool-result" style="color:#FF3B30">' + esc(resp.error) + '</div>';
            else { const p = resp.parsed; if (p.content) { const injected = injectContent(p); sa.innerHTML = '<div class="tool-result">' + (injected ? 'Injected' : esc(p.content).replace(/\n/g, '<br>')) + '</div>'; } else sa.innerHTML = '<div class="tool-result">Done</div>'; }
          } catch(e: any) { sa.innerHTML = '<div class="tool-result" style="color:#FF3B30">' + esc(e.message) + '</div>'; }
          cmdExec.textContent = 'Execute'; (cmdExec as any).disabled = false;
        });
      }

      // Context
      let contextImage: string | null = null;
      const dropZone = s.getElementById('o8-ctx-dropzone');
      const ctxPreview = s.getElementById('o8-ctx-preview');
      const ctxImg = s.getElementById('o8-ctx-img') as HTMLImageElement;
      const ctxDir = s.getElementById('o8-ctx-direction') as HTMLTextAreaElement;
      const ctxGen = s.getElementById('o8-ctx-generate') as HTMLButtonElement;
      const ctxOut = s.getElementById('o8-ctx-output');
      function updCtx() { if (ctxGen) ctxGen.disabled = !contextImage || !ctxDir?.value.trim(); }
      async function setContextImage(dataUrl: string) {
        // Auto-downscale any image to fit within proxy limits
        const compressed = await compressImage(dataUrl, 1568, 0.85);
        contextImage = compressed;
        if (ctxImg) ctxImg.src = contextImage;
        if (ctxPreview) ctxPreview.style.display = 'block';
        if (dropZone) dropZone.style.display = 'none';
        updCtx();
      }
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e: any) => { e.preventDefault(); dropZone.classList.remove('dragover'); const f = e.dataTransfer?.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = async () => { await setContextImage(r.result as string); }; r.readAsDataURL(f); } });
      }
      // Ctrl+V paste support for screenshots
      document.addEventListener('paste', (e: ClipboardEvent) => {
        // Only handle if context tab is visible
        const ctxTab = s.getElementById('tool-context');
        if (!ctxTab || ctxTab.style.display === 'none') return;
        const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (!item) return;
        const blob = item.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = async () => { await setContextImage(reader.result as string); };
        reader.readAsDataURL(blob);
        e.preventDefault();
      });
      // ===== INTELLIGENCE: Text paste interception for edit-distance =====
      // When a rep copies AI output and pastes into CRM, capture both to measure
      // how much they edited. Only fires when lastAiOutput is <10 min old.
      document.addEventListener('paste', (ev: ClipboardEvent) => {
        try {
          if (!lastAiOutput || Date.now() - lastAiOutput.timestamp > 600_000) return;
          const pastedText = ev.clipboardData?.getData('text/plain');
          if (!pastedText || pastedText.length < 20) return;
          // Skip if paste target is inside the Brevmont sidebar
          const target = ev.target as HTMLElement | null;
          if (target?.closest?.('#brevmont-sidebar-host') || target?.closest?.('[id^="o8"]')) return;
          // Find the closest matching AI output channel
          const channels = [
            { key: 'crm', text: lastAiOutput.crm },
            { key: 'email', text: lastAiOutput.email },
            { key: 'text', text: lastAiOutput.text },
          ];
          let bestChannel = '';
          let bestAiText = '';
          for (const ch of channels) {
            if (!ch.text) continue;
            // Rough similarity: shared words ratio
            const aiWords = new Set(ch.text.toLowerCase().split(/\s+/));
            const pasteWords = pastedText.toLowerCase().split(/\s+/);
            const overlap = pasteWords.filter(w => aiWords.has(w)).length;
            if (overlap / Math.max(pasteWords.length, 1) > 0.3) {
              bestChannel = ch.key;
              bestAiText = ch.text;
              break;
            }
          }
          if (!bestChannel || !bestAiText) return;
          // Fire-and-forget via background script
          browser.runtime.sendMessage({
            type: 'TELEMETRY_EDIT_DISTANCE',
            payload: {
              ai_output: bestAiText.slice(0, 5000),
              pasted_content: pastedText.slice(0, 5000),
              channel: bestChannel,
              platform: PLATFORM,
              customer_name: leadData?.customerName || safeExtractContactName() || null,
            }
          }).catch(() => {});
        } catch { /* never crash main flow */ }
      }, true);

      // ===== HONEST TRACKING: paste + send-click listeners on host page =====
      // Fires generation.pasted whenever a non-trivial paste lands in a host
      // composer, and generation.send_clicked when the host's Send button
      // (or Enter on chat composers) is clicked. send_clicked is LOW
      // confidence — a click is intent, not delivery. The dashboard is
      // labeled accordingly; we never claim the message was delivered.
      try {
        const HONEST_PASTE_SELECTORS: Record<string, string[]> = {
          gmail: ['div[role="textbox"][contenteditable="true"]'],
          messenger: ['div[contenteditable="true"][role="textbox"]', 'div[data-lexical-editor="true"]'],
          linkedin: ['div.msg-form__contenteditable', 'div[role="textbox"][contenteditable="true"]'],
          vinsolutions: ['textarea', 'div[contenteditable="true"]'],
          unknown: [],
        };
        const HONEST_SEND_SELECTORS: Record<string, string> = {
          gmail: 'div[role="button"][data-tooltip*="Send"], div[aria-label*="Send"]',
          messenger: 'div[role="button"][aria-label*="Send"], svg[aria-label*="Send"]',
          linkedin: 'button.msg-form__send-button',
          vinsolutions: 'button[id*="save"], button[id*="Save"]',
          unknown: '',
        };
        const honestPlatform = detectHonestPlatform();
        const pasteSel = (HONEST_PASTE_SELECTORS[honestPlatform] || []).join(',');
        if (pasteSel) {
          document.addEventListener('paste', (e: ClipboardEvent) => {
            try {
              const target = e.target as HTMLElement | null;
              if (!target) return;
              if (target.closest?.('#brevmont-sidebar-host') || target.closest?.('[id^="o8"]')) return;
              if (!target.matches?.(pasteSel) && !target.closest?.(pasteSel)) return;
              const pastedText = e.clipboardData?.getData('text/plain') || '';
              if (pastedText.length < 20) return;
              logEvent({
                event_type: 'generation.pasted',
                platform: honestPlatform,
                generation_id: (window as any).__brevmontLastGenerationId,
                action_metadata: { paste_length: pastedText.length },
              });
            } catch {}
          }, true);
        }
        const sendSel = HONEST_SEND_SELECTORS[honestPlatform];
        if (sendSel) {
          document.addEventListener('click', (e: MouseEvent) => {
            try {
              const target = e.target as HTMLElement | null;
              if (!target) return;
              if (target.matches?.(sendSel) || target.closest?.(sendSel)) {
                logEvent({
                  event_type: 'generation.send_clicked',
                  platform: honestPlatform,
                  generation_id: (window as any).__brevmontLastGenerationId,
                  action_metadata: { confidence: 'low', note: 'click intent only, not delivery' },
                });
              }
            } catch {}
          }, true);
        }
        if (honestPlatform === 'messenger' || honestPlatform === 'linkedin') {
          document.addEventListener('keydown', (e: KeyboardEvent) => {
            try {
              if (e.key !== 'Enter' || e.shiftKey) return;
              const active = document.activeElement as HTMLElement | null;
              if (!active) return;
              if (active.closest?.('#brevmont-sidebar-host') || active.closest?.('[id^="o8"]')) return;
              if (active.matches?.('[contenteditable="true"]')) {
                logEvent({
                  event_type: 'generation.send_clicked',
                  platform: honestPlatform,
                  generation_id: (window as any).__brevmontLastGenerationId,
                  action_metadata: { confidence: 'low', via: 'enter_key' },
                });
              }
            } catch {}
          }, true);
        }
      } catch { /* never break main flow */ }

      function clearContextImage() { contextImage = null; if (ctxPreview) ctxPreview.style.display = 'none'; if (dropZone) dropZone.style.display = 'flex'; updCtx(); }
      if (s.getElementById('o8-ctx-remove')) s.getElementById('o8-ctx-remove')!.addEventListener('click', clearContextImage);
      if (ctxDir) ctxDir.addEventListener('input', updCtx);
      // BUG 3: Attach mic to context direction input
      const ctxMic = s.getElementById('o8-ctx-mic');
      if (ctxDir && ctxMic) attachInlineMic(s, ctxDir, ctxMic);
      if (ctxGen) {
        ctxGen.addEventListener('click', async () => {
          if (!contextImage || !ctxDir?.value.trim()) return;
          ctxGen.textContent = 'Compressing...'; ctxGen.disabled = true; if (ctxOut) ctxOut.innerHTML = '';
          try {
            const compressed = await compressImage(contextImage, 800, 0.7);
            ctxGen.textContent = 'Analyzing...';
            const resp = await safeSend({ type: 'CONTEXT_REPLY', payload: { image: compressed, direction: ctxDir.value.trim() } });
            if (resp.error) {
              const msg = resp.error.includes('413') ? 'Screenshot too large — try a smaller crop' : resp.error;
              addOutput(s, 'Error', msg, 'o8-ctx-output');
            } else {
              // Parse context reply into sections like main generate
              const raw = resp.reply || resp.raw || '';
              const textMatch = raw.match(/(?:^|\n)TEXT\s*\n([\s\S]*?)(?=\n(?:EMAIL|CRM)|$)/i);
              const emailMatch = raw.match(/(?:^|\n)EMAIL\s*\n([\s\S]*?)(?=\n(?:CRM)|$)/i);
              const crmMatch = raw.match(/(?:^|\n)CRM(?: NOTE)?\s*\n([\s\S]*?)$/i);
              if (textMatch || emailMatch || crmMatch) {
                if (textMatch?.[1]?.trim()) addOutput(s, 'TEXT MESSAGE', textMatch[1].trim(), 'o8-ctx-output');
                if (emailMatch?.[1]?.trim()) addOutput(s, 'EMAIL', emailMatch[1].trim(), 'o8-ctx-output');
                if (crmMatch?.[1]?.trim()) addOutput(s, 'CRM NOTE', crmMatch[1].trim(), 'o8-ctx-output');
              } else {
                addOutput(s, 'REPLY', raw, 'o8-ctx-output');
              }
            }
          } catch(e: any) {
            if (e.message.includes('Reload') || e.message.includes('connection')) { showReconnectBanner(s); }
            const msg = e.message.includes('413') ? 'Screenshot too large — try a smaller crop' : e.message;
            addOutput(s, 'Error', msg, 'o8-ctx-output');
          }
          ctxGen.textContent = 'Generate Reply'; ctxGen.disabled = false; updCtx();
        });
      }

      // Gmail: fetch and render pending emails
      if (isGmail) {
        async function loadPendingEmails() {
          try {
            const resp = await safeSend({ type: 'GET_PENDING_EMAILS' });
            const emails = resp?.emails || [];
            const existing = s.getElementById('brevmont-pending-emails');
            if (existing) existing.remove();
            if (emails.length === 0) { updateGmailPillBadge(0); return; }
            updateGmailPillBadge(emails.length);
            const section = document.createElement('div');
            section.id = 'brevmont-pending-emails';
            section.style.cssText = 'padding:8px 12px;border-bottom:1px solid #E5E7EB;';
            let html = `<div style="font-size:12px;font-weight:700;color:#1a202c;margin-bottom:6px">📬 Pending Emails (${emails.length})</div>`;
            for (const em of emails) {
              const subjectPreview = (em.subject || 'No subject').slice(0, 40) + ((em.subject || '').length > 40 ? '…' : '');
              html += `<div class="brevmont-pe-card" data-id="${em.id}" data-subject="${esc(em.subject || '')}" data-body="${esc(em.body || '')}" style="padding:6px 0;border-bottom:1px solid #f3f4f6">
                <div style="font-size:13px;font-weight:600;color:#1a202c">${esc(em.customer_name || 'Unknown')}</div>
                <div style="font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(subjectPreview)}</div>
                <div style="display:flex;gap:4px;margin-top:4px">
                  <button class="brevmont-pe-apply" data-id="${em.id}" style="padding:3px 10px;background:#0D6E6E;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit">Apply</button>
                  <button class="brevmont-pe-dismiss" data-id="${em.id}" style="padding:3px 10px;background:transparent;border:1px solid #E5E7EB;color:#475569;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit">Dismiss</button>
                </div>
              </div>`;
            }
            section.innerHTML = html;
            const quickMode = s.getElementById('o8-quick');
            if (quickMode && quickMode.firstChild) quickMode.insertBefore(section, quickMode.firstChild);

            // Apply buttons — inject into Gmail compose
            section.querySelectorAll('.brevmont-pe-apply').forEach(btn => {
              btn.addEventListener('click', async () => {
                const card = (btn as HTMLElement).closest('.brevmont-pe-card') as HTMLElement;
                const id = (btn as HTMLElement).dataset.id;
                const subject = card?.dataset.subject || '';
                const body = card?.dataset.body || '';
                const composeBody = qSel(gmailSelectors, 'compose_body', 'div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement;
                if (composeBody) {
                  composeBody.focus(); safeInjectText(composeBody, body);
                  if (subject) { const subjectField = qSel(gmailSelectors, 'compose_subject', 'input[name="subjectbox"]') as HTMLInputElement; if (subjectField) { subjectField.focus(); safeInjectText(subjectField, subject); } }
                  (btn as HTMLElement).textContent = 'Applied';
                  (btn as HTMLElement).style.background = '#16a34a';
                } else {
                  navigator.clipboard.writeText(body);
                  (btn as HTMLElement).textContent = 'Copied';
                  (btn as HTMLElement).style.background = '#f59e0b';
                }
                try { await browser.runtime.sendMessage({ type: 'MARK_EMAIL_APPLIED', payload: { id, status: 'applied' } }); } catch(e) {}
                setTimeout(() => { card?.remove(); const remaining = section.querySelectorAll('.brevmont-pe-card').length; if (remaining === 0) section.remove(); updateGmailPillBadge(remaining); }, 1500);
              });
            });

            // Dismiss buttons
            section.querySelectorAll('.brevmont-pe-dismiss').forEach(btn => {
              btn.addEventListener('click', async () => {
                const card = (btn as HTMLElement).closest('.brevmont-pe-card') as HTMLElement;
                const id = (btn as HTMLElement).dataset.id;
                try { await browser.runtime.sendMessage({ type: 'MARK_EMAIL_APPLIED', payload: { id, status: 'dismissed' } }); } catch(e) {}
                card?.remove();
                const remaining = section.querySelectorAll('.brevmont-pe-card').length;
                if (remaining === 0) section.remove();
                updateGmailPillBadge(remaining);
              });
            });
          } catch(e: any) { dlog('[Brevmont] Pending emails fetch error:', e); logError('API_ERROR', e?.message || 'Pending emails fetch failed', 'gmail_pending_emails'); }
        }
        loadPendingEmails();
      }

      if (isVinSolutions) updateSidebar();
    }

    function pushContent(_open: boolean) { return; }

    // Re-anchor sidebar to the panel seam on resize/zoom
    // Also detect AddNote popup and shift sidebar to avoid blocking it
    let sidebarDodging = false;

    function dodgeSidebar() {
      if (!sidebarRoot || !isVinSolutions || !sidebarOpen) return;
      sidebarDodging = true;
      sidebarRoot.style.left = '0px';
      sidebarRoot.style.transition = 'left 0.2s ease';
    }

    function undodgeSidebar() {
      if (!sidebarRoot || !isVinSolutions || !sidebarDodging) return;
      sidebarDodging = false;
      const seam = findPanelSeamX();
      if (seam) sidebarRoot.style.left = (seam.seamX - 320) + 'px';
      setTimeout(() => { if (sidebarRoot) sidebarRoot.style.transition = ''; }, 250);
    }

    function isNotePopupOpen(): boolean {
      // Scan all iframe levels for AddNote / SendEmail / Communication popups
      function checkDoc(doc: Document): boolean {
        try {
          const iframes = doc.querySelectorAll('iframe');
          for (const f of iframes) {
            const src = (f.src || '').toLowerCase();
            if (src.includes('addnote') || src.includes('sendemail') || src.includes('send_email') || src.includes('communication')) {
              const r = f.getBoundingClientRect();
              if (r.width > 100 && r.height > 100) return true;
            }
            // Recurse
            try {
              const d = f.contentDocument || (f as any).contentWindow?.document;
              if (d && checkDoc(d)) return true;
            } catch(e) {}
          }
        } catch(e) {}
        return false;
      }
      return checkDoc(document);
    }

    function updateSidebarPosition() {
      if (!sidebarRoot || !isVinSolutions || !sidebarOpen) return;
      const seam = findPanelSeamX();
      if (!seam) return;
      const sidebarWidth = 340;

      // Auto-detect note popup and dodge
      if (isNotePopupOpen()) {
        if (!sidebarDodging) dodgeSidebar();
      } else {
        if (sidebarDodging) undodgeSidebar();
        sidebarRoot.style.left = (seam.seamX - sidebarWidth) + 'px';
      }
      sidebarRoot.style.top = seam.panelTop + 'px';
      // Mirror the openSidebar() ceiling expression so the idle-collapse
      // fix stays consistent across resize / seam reflows. height:'auto' set
      // in openSidebar is preserved (never reassigned here).
      sidebarRoot.style.maxHeight = `min(calc(100vh - 200px), ${seam.panelHeight}px)`;
    }

    function closeSidebar() {
      if (sidebarRoot) { sidebarRoot.style.display = 'none'; sidebarOpen = false; }
      if (pill) pill.style.display = 'block';
      pushContent(false);
    }

    function updateSidebar() {
      if (!sidebarRoot || !isVinSolutions) return;
      const s = sidebarRoot.shadowRoot!;
      const card = s.getElementById('o8-card'); if (!card) return;
      if (leadData?.customerName) {
        card.style.display = 'block';
        const nameEl = s.getElementById('o8-name')!;
        nameEl.textContent = leadData.customerName;
        nameEl.style.fontStyle = 'normal'; nameEl.style.color = '#1a202c';
        const vehEl = s.getElementById('o8-vehicle')!;
        if (leadData.vehicle) { vehEl.textContent = leadData.vehicle; vehEl.style.fontStyle = 'normal'; vehEl.style.color = '#2563eb'; }
        else { vehEl.textContent = 'No vehicle selected'; vehEl.style.fontStyle = 'italic'; vehEl.style.color = '#94a3b8'; }
        let meta = '';
        if (leadData.phone) meta += leadData.phone;
        if (leadData.email) meta += (meta ? ' · ' : '') + leadData.email;
        if (leadData.source) meta += (meta ? ' · ' : '') + leadData.source;
        s.getElementById('o8-meta')!.textContent = meta;

        // Auto-match pending notes for this customer
        const matchDiv = s.getElementById('o8-pending-match');
        if (matchDiv) matchDiv.remove();
        const matched = pendingNotes.find(n => n.customer_name && leadData.customerName && n.customer_name.toLowerCase() === leadData.customerName.toLowerCase());
        if (matched) {
          const div = document.createElement('div');
          div.id = 'o8-pending-match';
          div.innerHTML = `<div style="background:#FFF7ED;border:1px solid #FBBF24;border-radius:8px;padding:10px;margin-top:8px;font-size:11px"><strong style="color:#92400E">Pending note for ${esc(matched.customer_name)}</strong><div style="color:#64748b;margin:4px 0;line-height:1.4">${esc((matched.note_text || '').slice(0, 100))}</div><button id="o8-pn-log-match" style="padding:4px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">Log It</button></div>`;
          card.appendChild(div);
          div.querySelector('#o8-pn-log-match')?.addEventListener('click', async () => {
            const statusEl = document.createElement('span');
            await pasteIntoCRM(matched.note_text, statusEl);
            try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id: matched.id, status: 'logged' } }); } catch(e) {}
            div.remove();
            refreshPendingBadge();
          });
        }
      } else {
        card.style.display = 'block';
        const nameEl = s.getElementById('o8-name')!;
        nameEl.textContent = 'Open a customer record';
        nameEl.style.fontStyle = 'italic'; nameEl.style.color = '#94a3b8';
        s.getElementById('o8-vehicle')!.textContent = '';
        s.getElementById('o8-meta')!.textContent = '';
      }
    }

    // ===== GENERATE =====
    async function doGenerate(s: ShadowRoot) {
      if (isGenerating) return; isGenerating = true;
      // Demo build: no platform feature gates
      const input = (s.getElementById('o8-input') as HTMLTextAreaElement).value.trim();
      if (!input && !leadData?.customerName) { isGenerating = false; return; }
      const chips = s.querySelectorAll('.chip.on');
      const selected = Array.from(chips).map(c => c.getAttribute('data-type'));
      if (selected.length === 0) { isGenerating = false; return; }
      const type = selected.length === 3 ? 'all' : selected.length === 1 ? selected[0]! : 'all';
      const btn = s.getElementById('o8-generate') as HTMLButtonElement;
      btn.innerHTML = '<span class="gen-spinner"></span> Generating\u2026'; btn.disabled = true;
      s.getElementById('o8-outputs')!.innerHTML = '';
      // Reset tab-active state on chips before the new generation — stale
      // card-specific `.tab-active` would otherwise carry over when the DOM
      // is cleared above (the chip class lives on the chip, not the card).
      s.querySelectorAll('.chip.tab-active').forEach((c) => c.classList.remove('tab-active'));

      // Read tone/goal from storage for FIX 7
      let tone = 'professional'; let goal = 'close_deal';
      try { const stored = await browser.storage.local.get(['brevmont_tone', 'brevmont_goal']); tone = stored.brevmont_tone || 'professional'; goal = stored.brevmont_goal || 'close_deal'; } catch(e) {}

      // Build metadata safely — no scraper function can block generation
      let _meta: Record<string, any> = { workflow_type: type === 'all' ? 'all' : type };
      try { _meta.customer_name = leadData?.customerName || safeExtractContactName() || null; } catch { _meta.customer_name = null; }
      try { _meta.vehicle = leadData?.vehicle || null; } catch { _meta.vehicle = null; }
      try { _meta.customer_phone = leadData?.phone || null; } catch { _meta.customer_phone = null; }
      try { _meta.customer_email = leadData?.email || null; } catch { _meta.customer_email = null; }
      _meta.email = _meta.customer_email; // legacy field name kept for back-compat
      try { _meta.vehicle_make = leadData?.vehicleMake || null; } catch { _meta.vehicle_make = null; }
      try { _meta.vehicle_model = leadData?.vehicleModel || null; } catch { _meta.vehicle_model = null; }
      try { _meta.vehicle_of_interest = leadData?.vehicleOfInterest || leadData?.vehicle || null; } catch { _meta.vehicle_of_interest = null; }
      try { _meta.lead_created_at = scrapeLeadCreatedAt(); } catch { _meta.lead_created_at = null; }
      try { _meta.lead_source = leadData?.source || null; } catch { _meta.lead_source = null; }
      // generation_id: SAME UUID for the proxy call AND the post-render
      // generation.created honest events. Stored on window so the proxy
      // server can UPSERT event_log_v2 on the same row the extension wrote.
      const _generationId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      _meta.generation_id = _generationId;
      (window as any).__brevmontLastGenerationId = _generationId;

      try {
        const response = await safeSend({
          type: 'GENERATE_OUTPUT',
          payload: { type, leadContext: leadData || {}, repInput: input + (leadData?.vehicle ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not mention or invent a vehicle in the response.]'), repName: '', dealership: '', platform: PLATFORM, tone, goal,
            metadata: _meta }
        });
        if ((response as any).queued) {
          showToast(s, (response as any).message || 'Saved. Will sync when online.');
        } else if (response.error) addOutput(s, 'Error', response.error);
        else {
          const sec = response.sections;
          // Intelligence: store AI output for edit-distance tracking
          lastAiOutput = { text: sec?.text || '', email: sec?.email || '', crm: sec?.crm || '', timestamp: Date.now() };
          if (selected.includes('text') && sec.text) addOutput(s, outputLabels.text, sec.text); if (selected.includes('email') && sec.email) addOutput(s, outputLabels.email, sec.email); if (selected.includes('crm') && sec.crm) { if (sec.crm.trim() === 'NO_NEW_NOTE') { showToast(s, 'Nothing new to log. Last note covers this.'); } else { addOutput(s, outputLabels.crm, sec.crm); } } if (!sec.text && !sec.email && !sec.crm) addOutput(s, 'OUTPUT', response.text || 'Generation returned empty.');
          // Honest tracking — emit generation.created for each output the rep can see.
          // Reuses the SAME generation_id sent to the proxy (_generationId, _meta.generation_id)
          // so the server-side event_log_v2 UPSERT lands on the same row the
          // extension's logEvent() writes here.
          try {
            const generationId = _generationId;
            const honestPlatform = detectHonestPlatform();
            const honestCustomer = {
              name: (_meta && _meta.customer_name) || null,
              vehicle: (_meta && _meta.vehicle) || null,
            };
            const outputs: Array<{ key: 'text' | 'email' | 'crm'; content: string }> = [];
            if (selected.includes('text') && sec.text) outputs.push({ key: 'text', content: sec.text });
            if (selected.includes('email') && sec.email) outputs.push({ key: 'email', content: sec.email });
            if (selected.includes('crm') && sec.crm && sec.crm.trim() !== 'NO_NEW_NOTE') outputs.push({ key: 'crm', content: sec.crm });
            for (const o of outputs) {
              logEvent({
                event_type: 'generation.created',
                platform: honestPlatform,
                output_type: mapOutputType(o.key),
                generation_id: generationId,
                customer_context: honestCustomer,
                output_length: (o.content || '').length,
              });
            }
          } catch {}
        }
        // Tabbed outputs refactor (2026-04-19): auto-activate the first
        // generated output so the panel shows exactly one card post-gen.
        // Preference order: text → email → crm (matches the marketing demo
        // default and the rep's most common follow-up action).
        {
          const tabOrder: Array<'text'|'email'|'crm'> = ['text','email','crm'];
          const firstReady = tabOrder.find((t) => !!s.querySelector(`.out-card[data-output-type="${t}"]`));
          if (firstReady) setActiveOutputTab(s, firstReady);
        }
      } catch (e: any) {
        logError(e.message?.includes('connection') ? 'NETWORK_ERROR' : 'API_ERROR', e.message || 'doGenerate failed', `platform=${PLATFORM},type=${type}`);
        if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); }
        addOutput(s, 'Error', e.message.includes('invalidated') ? 'Brevmont needs a refresh. Click Reload Page above.' : e.message);
      }
      btn.innerHTML = 'Generate'; btn.disabled = false; isGenerating = false;
    }

    // ===== CRM PASTE =====
    function findNoteTextarea(): HTMLTextAreaElement | null { if (!isVinSolutions) return null; const iframes = document.querySelectorAll('iframe'); for (const iframe of iframes) { try { if (iframe.src?.includes('AddNote')) { const doc = iframe.contentDocument || (iframe as any).contentWindow?.document; if (doc) { const ta = doc.querySelector('textarea'); if (ta) return ta; } } } catch(e) {} } for (const iframe of iframes) { try { const doc = iframe.contentDocument || (iframe as any).contentWindow?.document; if (!doc) continue; if ((doc.body?.innerText || '').includes('Add Note') || (doc.body?.innerText || '').includes('Note Type')) { const ta = doc.querySelector('textarea'); if (ta) return ta; } } catch(e) {} } return null; }
    function clickNoteIcon(): boolean { if (!isVinSolutions) return false; for (const el of document.querySelectorAll('a, button, div, span, td')) { if (el.textContent?.trim() === 'Note' && (el as HTMLElement).offsetWidth > 0) { (el as HTMLElement).click(); return true; } } return false; }
    async function pasteIntoCRM(noteText: string, statusEl: HTMLElement) {
      if (!isVinSolutions) { statusEl.textContent = 'Available on your dealer CRM only'; return; }
      dodgeSidebar(); // Move sidebar out of the way before note popup opens
      statusEl.textContent = 'Opening note form...'; statusEl.style.color = '#2563eb';
      await browser.storage.local.set({ brevmont_paste_note: noteText, brevmont_paste_note_time: Date.now() });
      let textarea = findNoteTextarea();
      if (!textarea) { const clicked = clickNoteIcon(); if (clicked) { for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 500)); textarea = findNoteTextarea(); if (textarea) break; } } }
      if (textarea) { textarea.focus(); safeInjectText(textarea, noteText); statusEl.textContent = 'Pasted'; statusEl.style.color = '#16a34a'; textarea.style.border = '2px solid #16a34a'; setTimeout(() => { textarea!.style.border = ''; }, 2000); browser.storage.local.remove(['brevmont_paste_note', 'brevmont_paste_note_time']); }
      else {
        statusEl.textContent = 'Saved to pending notes'; statusEl.style.color = '#2563eb';
        // Persist to Supabase so it survives session/navigation
        try { browser.runtime.sendMessage({ type: 'SAVE_PENDING_NOTE', payload: { customer_name: leadData?.customerName || safeExtractContactName() || '', note_text: noteText, contact_id: null } }); } catch(e) {}
        refreshPendingBadge();
      }
    }

    // Paste email subject+body into VinSolutions Send Email popup
    async function pasteIntoEmail(emailContent: string, statusEl: HTMLElement) {
      if (!isVinSolutions) { navigator.clipboard.writeText(emailContent); statusEl.textContent = 'Copied'; statusEl.style.color = '#16a34a'; return; }
      statusEl.textContent = 'Finding email form...'; statusEl.style.color = '#2563eb';

      // Parse subject and body
      let subject = ''; let body = emailContent;
      const subjectMatch = emailContent.match(/^Subject:\s*(.+)/im);
      if (subjectMatch) { subject = subjectMatch[1].trim(); body = emailContent.slice(subjectMatch.index! + subjectMatch[0].length).trim(); }
      body = body.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/#{1,6}\s/g, '').trim();

      // Search ALL iframes (nested too) for the email compose form
      function tryInjectInDoc(doc: Document): boolean {
        // Subject field
        if (subject) {
          const subj = qSel(vinSelectors, 'email_subject_input', 'input[id*="ubject"], input[name*="ubject"], input[id*="Subject"], input[name*="Subject"]', doc) as HTMLInputElement;
          if (subj) { subj.focus(); safeInjectText(subj, subject); }
        }
        // Body: contenteditable > textarea > nested iframe body
        const editable = doc.querySelector('[contenteditable="true"]') as HTMLElement;
        if (editable) { editable.focus(); safeInjectText(editable, body); return true; }
        const ta = doc.querySelector('textarea') as HTMLTextAreaElement;
        if (ta) { ta.focus(); safeInjectText(ta, body); return true; }
        // Nested iframe (rich text editor like TinyMCE)
        for (const nf of doc.querySelectorAll('iframe')) {
          try { const nd = nf.contentDocument || (nf as any).contentWindow?.document; if (nd?.body) { safeInjectText(nd.body, body); return true; } } catch(e) {}
        }
        return false;
      }

      let found = false;
      // Search all iframes for email-related ones
      const allIframes = document.querySelectorAll('iframe');
      for (const iframe of allIframes) {
        try {
          const src = (iframe.src || '').toLowerCase();
          if (!src.includes('email') && !src.includes('sendemail') && !src.includes('send_email') && !src.includes('communication')) continue;
          const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
          if (doc && tryInjectInDoc(doc)) { found = true; break; }
        } catch(e) {}
      }

      // Also check popup windows via VinSolutions texting/email popups
      if (!found) {
        // The email popup is often a rims2.aspx Communication page — look for it
        for (const iframe of allIframes) {
          try {
            const src = (iframe.src || '').toLowerCase();
            if (!src.includes('rims2') && !src.includes('communication')) continue;
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (!doc) continue;
            // Search nested iframes inside this communication frame
            for (const inner of doc.querySelectorAll('iframe')) {
              try {
                const innerDoc = inner.contentDocument || (inner as any).contentWindow?.document;
                if (innerDoc && tryInjectInDoc(innerDoc)) { found = true; break; }
              } catch(e) {}
            }
            if (found) break;
          } catch(e) {}
        }
      }

      if (found) {
        statusEl.textContent = 'Pasted to email'; statusEl.style.color = '#16a34a';
      } else {
        // Fallback: copy to clipboard + stage for auto-paste
        navigator.clipboard.writeText(emailContent);
        await browser.storage.local.set({ brevmont_paste_email_subject: subject, brevmont_paste_email_body: body, brevmont_paste_email_time: Date.now() });
        statusEl.textContent = 'Copied. Paste into email manually.'; statusEl.style.color = '#2563eb';
      }
    }

    // Tabbed outputs refactor (2026-04-19): make the Message / Email / CRM
    // Note chips behave as tabs post-generation. Pre-generation they remain
    // include-in-next-generation toggles (`.on`). Post-generation, clicking a
    // chip whose output exists switches the visible card — no regeneration,
    // no scroll. Keeps the panel compact regardless of how many outputs were
    // generated. Matches the marketing demo UX at brevmont.com/try.
    function setActiveOutputTab(s: ShadowRoot, type: string) {
      // Dim all chips, highlight active
      s.querySelectorAll('.chip').forEach((c) => {
        c.classList.remove('tab-active');
        (c as HTMLElement).style.opacity = '0.5';
      });
      const activeChip = s.querySelector(`.chip[data-type="${type}"]`);
      if (activeChip) {
        activeChip.classList.add('tab-active');
        (activeChip as HTMLElement).style.opacity = '1';
      }
      // Hide all output cards
      s.querySelectorAll('.out-card').forEach((card) => {
        card.classList.remove('tab-visible');
        (card as HTMLElement).style.display = 'none';
      });
      // Show only the matching card
      const activeCard = s.querySelector(`.out-card[data-output-type="${type}"]`);
      if (activeCard) {
        activeCard.classList.add('tab-visible');
        (activeCard as HTMLElement).style.display = 'block';
      }
    }

    function addOutput(s: ShadowRoot, label: string, content: string, containerId: string = 'o8-outputs') {
      const container = s.getElementById(containerId) || s.getElementById('o8-outputs')!;
      const card = document.createElement('div'); card.className = 'out-card';
      const isCRM = label === 'CRM NOTE' || label === 'NOTE';
      const isEmail = label === 'EMAIL' || label === 'EMAIL REPLY';
      const isText = !isCRM && !isEmail;
      // Tabbed outputs refactor (2026-04-19): stamp the card with a type that
      // matches the chip's data-type. CSS hides non-active cards so the panel
      // shows one output at a time instead of stacking all three. Untyped
      // labels (Error / OUTPUT / REPLY) stay unstamped and fall through the
      // CSS default — they always render.
      const outputType = isCRM ? 'crm' : isEmail ? 'email' : isText ? 'text' : '';
      if (outputType) card.dataset.outputType = outputType;

      // Primary button label — platform × output type
      let primaryLabel = 'Copy';
      if (isCRM && isVinSolutions) primaryLabel = 'Paste to CRM';
      else if (isCRM && !isVinSolutions) primaryLabel = 'Log to CRM';
      else if (isEmail && !isVinSolutions && !isGmail) primaryLabel = 'Queue Email';
      else if (isText && isFacebook) primaryLabel = 'Send to Messenger';
      else if (isText && isLinkedIn) primaryLabel = 'Send to LinkedIn';
      else if (isEmail && isGmail) primaryLabel = 'Apply to Email';

      // Two buttons only: primary (solid) + Regenerate (ghost)
      const CRM_NOTE_CHAR_LIMIT = 500;
      card.innerHTML = `<div class="out-label">${esc(label)}</div><textarea class="out-textarea">${esc(content)}</textarea>${isCRM ? `<div class="crm-char-count" style="font-size:11px;font-family:'JetBrains Mono',monospace;text-align:right;padding:2px 8px 0;color:#6B6B6B;">${content.length} / ${CRM_NOTE_CHAR_LIMIT}</div>` : ''}<div class="out-actions"><button class="out-action out-primary">${primaryLabel}</button><button class="out-action out-regen">Regenerate</button></div><div class="out-status"></div>`;

      const getContent = () => (card.querySelector('.out-textarea') as HTMLTextAreaElement)?.value || content;

      // CRM note character counter — live update on edit
      if (isCRM) {
        const textarea = card.querySelector('.out-textarea') as HTMLTextAreaElement;
        const counter = card.querySelector('.crm-char-count') as HTMLElement;
        if (textarea && counter) {
          const updateCounter = () => {
            const len = textarea.value.length;
            counter.textContent = `${len} / ${CRM_NOTE_CHAR_LIMIT}`;
            if (len > CRM_NOTE_CHAR_LIMIT * 0.95) counter.style.color = '#B91C1C';
            else if (len > CRM_NOTE_CHAR_LIMIT * 0.8) counter.style.color = '#C4841D';
            else counter.style.color = '#1A7A4C';
          };
          updateCounter();
          textarea.addEventListener('input', updateCounter);
        }
      }

      // Primary action — always copies to clipboard as side effect
      const primaryBtn = card.querySelector('.out-primary');
      if (primaryBtn) {
        primaryBtn.addEventListener('click', function(this: HTMLElement) {
          const st = card.querySelector('.out-status') as HTMLElement;
          const curContent = getContent();
          navigator.clipboard.writeText(curContent); // always copy
          // Honest tracking — primary button always copies, so emit generation.copied.
          try {
            logEvent({
              event_type: 'generation.copied',
              platform: detectHonestPlatform(),
              output_type: mapOutputType((card as HTMLElement).dataset.outputType),
              generation_id: (window as any).__brevmontLastGenerationId,
              output_length: (curContent || '').length,
            });
          } catch {}

          if (isCRM && isVinSolutions) {
            (this as any).disabled = true; this.textContent = 'Pasting...';
            pasteIntoCRM(curContent, st).then(() => { this.textContent = 'Paste to CRM'; (this as any).disabled = false; });
          } else if (isCRM && !isVinSolutions) {
            // Log to CRM — save as pending note for VinSolutions
            const custName = leadData?.customerName || document.title.split(' - ')[0] || 'Unknown Customer';
            try { browser.runtime.sendMessage({ type: 'SAVE_PENDING_NOTE', payload: { customer_name: custName, note_text: curContent, contact_id: null } }); } catch(e) {}
            this.textContent = 'Queued'; this.style.background = '#16a34a'; this.style.color = '#fff';
            st.textContent = 'Note queued for your CRM'; st.style.color = '#16a34a';
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'CRM_NOTE_QUEUED', platform: PLATFORM, customer: custName } }); } catch(e) {}
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 2000);
          } else if (isEmail && !isVinSolutions && !isGmail) {
            // Queue Email — save to pending_emails for later Gmail send
            let subject = ''; let body = curContent;
            const subjectMatch = curContent.match(/^(?:Subject:\s*|Re:\s*)(.+)/i);
            if (subjectMatch) { subject = subjectMatch[1].trim(); body = curContent.slice(curContent.indexOf('\n') + 1).trim(); }
            const custName = leadData?.customerName || document.title.split(' - ')[0] || 'Unknown Customer';
            try { browser.runtime.sendMessage({ type: 'SAVE_PENDING_EMAIL', payload: { customer_name: custName, subject, body } }); } catch(e) {}
            this.textContent = 'Queued'; this.style.background = '#16a34a'; this.style.color = '#fff';
            st.textContent = 'Email queued. Open Gmail to send.'; st.style.color = '#16a34a';
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'EMAIL_QUEUED', platform: PLATFORM, customer: custName } }); } catch(e) {}
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 2000);
          } else if (isText && isFacebook) {
            const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement;
            if (box) { box.focus(); safeInjectText(box, curContent); this.textContent = 'Sent'; this.style.background = '#16a34a'; this.style.color = '#fff'; st.textContent = 'Sent to Messenger'; st.style.color = '#16a34a'; }
            else { this.textContent = 'Copied'; this.style.background = '#16a34a'; this.style.color = '#fff'; st.textContent = 'Copied. Open a conversation first.'; st.style.color = '#f59e0b'; }
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label, platform: PLATFORM, customer: leadData?.customerName || safeExtractContactName() || null } }); } catch(e) {}
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 2000);
          } else if (isText && isLinkedIn) {
            const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement;
            if (box) { box.focus(); safeInjectText(box, curContent); this.textContent = 'Sent'; this.style.background = '#16a34a'; this.style.color = '#fff'; st.textContent = 'Sent to LinkedIn'; st.style.color = '#16a34a'; }
            else { this.textContent = 'Copied'; this.style.background = '#16a34a'; this.style.color = '#fff'; st.textContent = 'Copied. Open a conversation first.'; st.style.color = '#f59e0b'; }
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label, platform: PLATFORM, customer: leadData?.customerName || safeExtractContactName() || null } }); } catch(e) {}
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 2000);
          } else if (isEmail && isGmail) {
            let subject = ''; let body = curContent;
            const subjectMatch = curContent.match(/^(?:Subject:\s*|Re:\s*)(.+)/i);
            if (subjectMatch) { subject = subjectMatch[1].trim(); body = curContent.slice(curContent.indexOf('\n') + 1).trim(); }
            const composeBody = qSel(gmailSelectors, 'compose_body', 'div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement;
            if (composeBody) {
              composeBody.focus(); safeInjectText(composeBody, body);
              if (subject) { const subjectField = qSel(gmailSelectors, 'compose_subject', 'input[name="subjectbox"]') as HTMLInputElement; if (subjectField) { subjectField.focus(); safeInjectText(subjectField, subject); } }
              this.textContent = 'Applied'; this.style.background = '#16a34a'; this.style.color = '#fff'; st.textContent = 'Applied to compose'; st.style.color = '#16a34a';
              try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'EMAIL_APPLIED', platform: PLATFORM, customer: leadData?.customerName || safeExtractContactName() || null } }); } catch(e) {}
            } else {
              this.textContent = 'Copied'; this.style.background = '#f59e0b'; this.style.color = '#fff'; st.textContent = 'Copied. Open a compose window first.'; st.style.color = '#f59e0b';
            }
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 2000);
          } else {
            // Default: Copy
            this.textContent = 'Copied'; this.style.background = '#16a34a'; this.style.color = '#fff';
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label, platform: PLATFORM, customer: leadData?.customerName || safeExtractContactName() || null } }); } catch(e) {}
            setTimeout(() => { this.textContent = primaryLabel; this.style.background = ''; this.style.color = ''; }, 1500);
          }
        });
      }

      // Regenerate (ghost) — clicks the Generate button again
      const regenBtn = card.querySelector('.out-regen');
      if (regenBtn) {
        regenBtn.addEventListener('click', () => {
          // Honest tracking — emit before card removal so DOM still has type info.
          try {
            logEvent({
              event_type: 'generation.regenerated',
              platform: detectHonestPlatform(),
              output_type: mapOutputType((card as HTMLElement).dataset.outputType),
              generation_id: (window as any).__brevmontLastGenerationId,
            });
          } catch {}
          card.remove();
          const genBtn = s.getElementById('o8-generate');
          if (genBtn) genBtn.click();
        });
      }

      container.appendChild(card);
    }

    function injectContent(parsed: any): boolean {
      const { action, content, subject } = parsed;
      if ((action === 'write_email' || PLATFORM === 'gmail') && isGmail) { const body = qSel(gmailSelectors, 'compose_body', 'div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement; if (body) { body.focus(); safeInjectText(body, content); if (subject) { const subj = qSel(gmailSelectors, 'compose_subject', 'input[name="subjectbox"]') as HTMLInputElement; if (subj) { subj.focus(); safeInjectText(subj, subject); } } return true; } }
      if ((action === 'write_facebook_message' || PLATFORM === 'facebook') && isFacebook) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if ((action === 'write_linkedin_message' || PLATFORM === 'linkedin') && isLinkedIn) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if (action === 'log_crm_note' && isVinSolutions) { pasteIntoCRM(content, document.createElement('span')); return true; }
      return false;
    }

    // ===== LISTENERS =====
    browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
      if (msg.type === 'GET_CRM_PAGE_CONTEXT') {
        try {
          const path = window.location.pathname || '';
          let ctx = 'unknown';
          if (PLATFORM === 'vinsolutions') {
            if (/AddNote/i.test(path) || (document.body?.innerText || '').includes('Add Note')) ctx = 'VinSolutions_AddNote';
            else if (/Contact/i.test(path)) ctx = 'VinSolutions_ContactRecord';
            else ctx = 'VinSolutions_' + (path.replace(/\//g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'home');
          } else {
            ctx = `${PLATFORM}_${path.split('/').filter(Boolean).slice(-2).join('_') || 'page'}`;
          }
          sendResponse({ context: ctx });
        } catch {
          sendResponse({ context: 'unknown' });
        }
        return false;
      }
      if (msg.type === 'OPEN_COMMAND_TAB' && sidebarRoot) { if (!sidebarOpen) openSidebar(); const s = sidebarRoot.shadowRoot!; s.getElementById('o8-quick')!.style.display = 'none'; const tp = s.getElementById('o8-tools-panel'); if (tp) tp.style.display = 'flex'; s.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active')); s.querySelector('.tool-tab-btn[data-tool="command"]')?.classList.add('active'); s.querySelectorAll('.tool-content').forEach(c => (c as HTMLElement).style.display = 'none'); s.getElementById('tool-command')!.style.display = 'block'; }
      if (msg.type === 'SHOW_ALERT_BANNER') { const existing = document.getElementById('brevmont-alert-banner'); if (existing) existing.remove(); const banner = document.createElement('div'); banner.id = 'brevmont-alert-banner'; Object.assign(banner.style, { position:'fixed', top:'0', left:'0', right:'0', zIndex:'999999', background:'#0F1419', color:'#F8F6F1', padding:'12px 20px', fontFamily:'Inter, sans-serif', fontSize:'14px', fontWeight:'600', display:'flex', alignItems:'center', gap:'10px', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }); banner.innerHTML = `<span style="flex:1">${esc(msg.payload.task)}</span><button style="background:#0D6E6E;border:none;color:#F8F6F1;padding:6px 16px;border-radius:6px;font-family:Inter,sans-serif;font-size:12px;font-weight:600;cursor:pointer">Dismiss</button>`; banner.querySelector('button')!.addEventListener('click', () => { banner.remove(); browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id: msg.payload.id } }); }); document.body.appendChild(banner); }
    });

    function parseAlertTime(text: string): number {
      const now = Date.now();
      // "in X minutes"
      const inMin = text.match(/in\s+(\d+)\s*min/i);
      if (inMin) return now + parseInt(inMin[1]) * 60000;
      // "in X hours"
      const inHr = text.match(/in\s+(\d+)\s*hour/i);
      if (inHr) return now + parseInt(inHr[1]) * 3600000;
      // "noon" / "by noon"
      if (/\bnoon\b/i.test(text)) { const d = new Date(); d.setHours(12, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
      // "end of day" / "eod" / "close"
      if (/\b(eod|end of day|close of business|cob)\b/i.test(text)) { const d = new Date(); d.setHours(17, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
      // "tomorrow" adds 24 hours to any parsed time
      const isTomorrow = /\btomorrow\b/i.test(text);
      // "at/by X:XX am/pm"
      const byTime = text.match(/(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (byTime) {
        let h = parseInt(byTime[1]); const m = byTime[2] ? parseInt(byTime[2]) : 0;
        const ampm = (byTime[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        if (!ampm && h < 7) h += 12;
        const d = new Date(); d.setHours(h, m, 0, 0);
        if (isTomorrow) d.setDate(d.getDate() + 1);
        else if (d.getTime() < now) d.setDate(d.getDate() + 1);
        return d.getTime();
      }
      // Default: 30 minutes from now
      return now + 30 * 60000;
    }

    async function loadAlerts(s: ShadowRoot) { let alerts: any[] = []; try { alerts = await safeSend({ type: 'GET_ALERTS' }); } catch(e: any) { if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); } return; } const list = s.getElementById('o8-alert-list'); if (!list) return; if (!alerts || alerts.length === 0) { list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">No active reminders</div>'; return; } list.innerHTML = alerts.map((a: any) => `<div class="alert-item"><span>${esc(a.task)}</span><span class="alert-time">${new Date(a.alertTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="alert-dismiss" data-id="${a.id}">&times;</button></div>`).join(''); list.querySelectorAll('.alert-dismiss').forEach(btn => { btn.addEventListener('click', async () => { const id = (btn as HTMLElement).dataset.id; if (id) { await browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(s); } }); }); }

    function esc(s: string) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function getBadge() {
      switch (PLATFORM) {
        case 'vinsolutions': return { label: 'Dealer CRM', color: '#0D6E6E', bg: '#F0EFFF' };
        case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
        case 'facebook': return { label: 'Messenger', color: '#1877f2', bg: '#eff6ff' };
        case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
        case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
        case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
        default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
      }
    }

    // Demo build: no gate cards — all features unlocked

    // Settings HTML — all unlocked (demo build)
    function getSettingsHTML(): string {
      return `<div class="settings-section">
        <div class="settings-label">Tone</div>
        <div class="settings-options"><label><input type="radio" name="brevmont-tone" value="professional" checked> Professional</label><label><input type="radio" name="brevmont-tone" value="friendly"> Friendly</label><label><input type="radio" name="brevmont-tone" value="casual"> Casual</label><label><input type="radio" name="brevmont-tone" value="direct"> Direct</label></div>
        <div class="settings-label">Goal</div>
        <div class="settings-options"><label><input type="radio" name="brevmont-goal" value="close_deal" checked> Close the deal</label><label><input type="radio" name="brevmont-goal" value="book_appointment"> Book appointment</label><label><input type="radio" name="brevmont-goal" value="gather_info"> Gather info</label><label><input type="radio" name="brevmont-goal" value="nurture"> Nurture long-term</label></div>
      </div>`;
    }

    function getHTML(): string {
      const badge = getBadge();
      const customerCard = isVinSolutions ? `<div id="o8-card" class="card"><div id="o8-name" class="name" style="font-style:italic;color:#94a3b8">Open a customer record</div><div id="o8-vehicle" class="vehicle"></div><div id="o8-meta" class="meta"></div></div>` : '';
      const placeholder = isVinSolutions ? 'Describe the situation or tap the mic...' : isGmail ? 'Describe the email situation...' : isFacebook ? 'Describe the conversation...' : isLinkedIn ? 'Describe the LinkedIn interaction...' : isInstagram ? 'Describe the DM...' : 'Describe the situation...';

      return `
<div class="header">
  <svg class="header-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#0D6E6E"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">BM</text></svg>
  <span class="logo">BREVMONT</span>
  <span class="version-badge" id="o8-version-badge"></span>
  <span style="flex:1"></span>
  <button id="o8-lead-btn" class="lead-btn">+ Lead</button>
  <span id="o8-close" class="close">&times;</span>
</div>
<div id="o8-quick" class="quick-mode">
  ${customerCard}
  <div class="input-section">
    <div class="chips">
      <button class="chip on" data-type="text">Message</button>
      <button class="chip on" data-type="email">Email</button>
      <button class="chip on" data-type="crm">CRM Note</button>
    </div>
    <div class="input-wrap">
      <textarea id="o8-input" class="main-input" placeholder="${esc(placeholder)}" rows="3"></textarea>
      <button id="o8-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>
    </div>
    <button id="o8-generate" class="gen-btn">Generate</button>
    ${isVinSolutions ? `<div id="o8-outcome-section" class="outcome-section" style="display:none; margin-top:8px; padding:8px; background:#f8fafc; border-radius:8px; border:1px solid #E5E7EB;">
  <div style="font-size:11px; font-weight:600; color:#64748b; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Deal Outcome</div>
  <select id="o8-outcome-select" style="width:100%; padding:8px; border:1px solid #E5E7EB; border-radius:6px; font-size:12px; background:#fff; margin-bottom:6px;">
    <option value="">Select outcome...</option>
    <option value="vehicle_sold">Vehicle Sold</option>
    <option value="appointment_set">Appointment Set</option>
    <option value="appointment_completed">Appointment Completed</option>
    <option value="deal_lost">Deal Lost</option>
    <option value="no_response">No Response</option>
  </select>
  <button id="o8-outcome-btn" class="gen-btn" style="background:#34C759; font-size:12px; padding:8px;">Mark Outcome</button>
  <div id="o8-outcome-status" style="font-size:11px; color:#64748b; text-align:center; margin-top:4px;"></div>
</div>` : ''}
    <div class="inline-links"><button id="o8-tools-btn-inline" class="link-btn">Tools</button><span class="link-sep">|</span><button id="o8-stats-btn-inline" class="link-btn">My Stats</button><span class="link-sep">|</span><button id="o8-settings-btn-inline" class="link-btn">Settings</button></div>
    <div class="tcpa-inline">Messages are for human review. TCPA compliance is your responsibility.</div>
  </div>
  <div id="o8-outputs" class="outputs"></div>
</div>
<div id="o8-tools-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-tools-back" class="back-btn">← Back</button><span class="tools-title">Tools</span></div>
  <div class="tool-tabs">
    <button class="tool-tab-btn active" data-tool="coach">Coach</button>
    <button class="tool-tab-btn" data-tool="alerts">Alerts</button>
    <button class="tool-tab-btn" data-tool="context">Context</button>
    <button class="tool-tab-btn" data-tool="command">Command</button>
  </div>
  <div id="tool-coach" class="tool-content" style="display:block"><div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div></div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g. Move the Tacoma by noon" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#FF9500">Set Alert</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-context" class="tool-content" style="display:none"><div class="tool-section"><div id="o8-ctx-dropzone" class="ctx-dropzone"><span>Drop screenshot or paste (Ctrl+V)</span></div><div id="o8-ctx-preview" class="ctx-preview" style="display:none"><img id="o8-ctx-img" class="ctx-img" /><button id="o8-ctx-remove" class="ctx-remove">&times;</button></div><div class="input-wrap"><textarea id="o8-ctx-direction" class="main-input" placeholder="What do you want to say?" rows="2"></textarea><button id="o8-ctx-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-ctx-generate" class="gen-btn" disabled>Generate Reply</button></div><div id="o8-ctx-output" class="tool-output"></div></div>
  <div id="tool-command" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-cmd-input" class="main-input" placeholder="Type a command..." rows="2"></textarea><button id="o8-cmd-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-cmd-execute" class="gen-btn">Execute</button></div><div id="o8-cmd-status" class="tool-output"></div></div>
</div>
<div id="o8-stats-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-stats-back" class="back-btn">← Back</button><span class="tools-title">My Stats</span></div>
  <div id="o8-stats-content" class="tool-section" style="padding:12px;">
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>
  </div>
</div>
<div id="o8-settings-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-settings-back" class="back-btn">← Back</button><span class="tools-title">Settings</span></div>
  ${getSettingsHTML()}
</div>
<div id="o8-lead-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-lead-back" class="back-btn">← Back</button><span class="tools-title">Capture Lead</span></div>
  <div class="tool-tabs">
    <button class="lead-tab-btn active" data-ltab="scan">Scan</button>
    <button class="lead-tab-btn" data-ltab="voice">Voice</button>
    <button class="lead-tab-btn" data-ltab="paste">Paste</button>
  </div>
  <div id="lead-scan" class="tool-content" style="display:block"><div class="tool-section"><button id="o8-scan-btn" class="gen-btn">Scan This Page</button><div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:8px">Brevmont will read this conversation and extract the contact automatically.</div></div></div>
  <div id="lead-voice" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-lead-voice-input" class="main-input" placeholder="Tap mic and describe the lead..." rows="3"></textarea><button id="o8-lead-voice-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-lead-voice-parse" class="gen-btn" style="margin-top:8px">Parse</button></div></div>
  <div id="lead-paste" class="tool-content" style="display:none"><div class="tool-section"><textarea id="o8-lead-paste-input" class="main-input" placeholder="Paste a message, text thread, or any contact info here." rows="4"></textarea><button id="o8-lead-paste-parse" class="gen-btn" style="margin-top:8px">Parse</button></div></div>
  <div id="o8-lead-result" class="tool-content" style="display:none"></div>
</div>
`;
    }

    function getCSS(width: string): string {
      return `
* { margin:0; padding:0; box-sizing:border-box; }
:host { all:initial; font-family:system-ui,-apple-system,sans-serif; font-size:13px; color:#1a202c; }
#o8 { width:${width}; height:auto; max-height:100%; background:#FFFFFF; border:1px solid #E5E7EB; border-radius:12px; box-shadow:0 0 0 1px rgba(0,0,0,0.05), 0 8px 24px -4px rgba(0,0,0,0.1); overflow:hidden; overscroll-behavior:contain; display:flex; flex-direction:column; padding-bottom:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.header { position:relative; padding:0 14px; height:48px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; gap:8px; flex-shrink:0; background:#fff; border-radius:12px 12px 0 0; }
.header-icon { flex-shrink:0; }
.logo { font-size:13px; font-weight:500; color:#1a202c; letter-spacing:0.5px; }
.version-badge { position:absolute; top:2px; left:14px; font-size:8px; font-family:'JetBrains Mono',ui-monospace,monospace; color:#0D6E6E; background:transparent; padding:0; border-radius:0; margin:0; letter-spacing:0; white-space:nowrap; line-height:1; pointer-events:none; opacity:0.7; }
.close { font-size:20px; color:#94a3b8; cursor:pointer; padding:0 4px; flex-shrink:0; line-height:1; } .close:hover { color:#475569; }
.quick-mode { display:flex; flex-direction:column; flex:0 0 auto; overflow:hidden; }
.card { padding:10px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.name { font-size:14px; font-weight:600; } .vehicle { font-size:11px; color:#2563eb; margin-top:1px; } .meta { font-size:10px; color:#64748b; margin-top:2px; }
.input-section { padding:12px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.chips { display:flex; gap:5px; margin-bottom:8px; }
.chip { padding:5px 12px; border-radius:16px; font-size:11px; font-weight:600; font-family:inherit; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all 0.15s; position:relative; }
.chip.on { border-color:#0D6E6E; color:#0D6E6E; background:#F0EFFF; }
.chip.on::after { content:''; position:absolute; top:-2px; right:-2px; width:7px; height:7px; border-radius:50%; background:#16a34a; border:1.5px solid #fff; }
/* Tabbed-outputs refactor (2026-04-19): .tab-active = currently viewed tab. */
.chip.tab-active { background:#0D6E6E; color:#F5F1E8; border-color:#0D6E6E; }
.chip.tab-active.on::after { background:#F5F1E8; border-color:#0D6E6E; }
.input-wrap { position:relative; display:flex; align-items:flex-start; }
.main-input { flex:1; padding:8px 40px 8px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; resize:none; outline:none; color:#1a202c; }
.main-input:focus { border-color:#0D6E6E; } .main-input::placeholder { color:#94a3b8; }
/* FIX 6: Visible mic button */
.inline-mic { position:absolute; right:6px; top:6px; width:28px; height:28px; border-radius:50%; border:none; background:#0D6E6E; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
.inline-mic:hover { background:#0A5555; transform:scale(1.05); }
.inline-mic.mic-active { background:#B91C1C; animation:mic-pulse 1s infinite; }
@keyframes mic-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }
.gen-btn { width:100%; padding:10px; background:#0D6E6E; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:8px; transition:background 0.15s; }
.gen-btn:hover { background:#0A5555; } .gen-btn:disabled { background:#94a3b8; cursor:wait; }
.gen-spinner { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:gen-spin 0.6s linear infinite; vertical-align:middle; margin-right:4px; }
@keyframes gen-spin { to { transform:rotate(360deg); } }
.outputs { padding:0 14px; overflow-y:auto; flex:0 0 auto; }
.outputs:not(:empty) { padding:8px 14px; flex:1 1 auto; min-height:0; }
.out-card { background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:10px 12px; margin-bottom:8px; }
/* Tabbed-outputs refactor (2026-04-19): stamped typed cards hide unless the
   matching chip is .tab-active. Untyped cards (Error / OUTPUT / REPLY) have
   no data-output-type and fall through — they always render. */
.out-card[data-output-type]:not(.tab-visible) { display:none !important; }
.out-card[data-output-type].tab-visible { display:block !important; }
.out-label { font-size:9px; font-weight:700; color:#0D6E6E; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
.out-textarea { width:100%; min-height:120px; max-height:300px; height:auto; padding:10px; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; line-height:1.6; font-family:inherit; color:#1a202c; background:#fff; resize:vertical; outline:none; } .out-textarea:focus { border-color:#0D6E6E; }
.out-actions { display:flex; gap:6px; margin-top:8px; }
.out-status { font-size:10px; margin-top:4px; min-height:14px; }
.out-action { padding:6px 14px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s; }
.out-primary { background:#0D6E6E; border:1px solid #6B63C7; color:#fff; } .out-primary:hover { background:#0A5555; }
.out-regen { background:transparent; border:1px solid #E5E7EB; color:#475569; } .out-regen:hover { background:#f3f4f6; }
.tools-panel { display:flex; flex-direction:column; flex:1; overflow:hidden; }
.tools-header { padding:10px 14px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; gap:8px; }
.back-btn { background:none; border:none; color:#0D6E6E; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; } .tools-title { font-size:13px; font-weight:600; }
.tool-tabs { display:flex; border-bottom:1px solid #e8eaed; }
.tool-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .tool-tab-btn.active { color:#0D6E6E; border-bottom-color:#0D6E6E; }
.tool-content { padding:12px 14px; flex:1; overflow-y:auto; display:none; }
.tool-section { display:flex; flex-direction:column; gap:8px; } .tool-output { padding:8px 0; }
.tool-result { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12px; line-height:1.6; margin-top:8px; }
.coach-chips { display:flex; flex-wrap:wrap; gap:4px; } .coach-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; } .coach-chip:hover { border-color:#0D6E6E; color:#0D6E6E; background:#F0EFFF; }
.inline-links { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:8px; } .link-btn { background:none; border:none; color:#0D6E6E; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; padding:2px 4px; } .link-btn:hover { text-decoration:underline; } .link-sep { color:#e2e8f0; font-size:11px; }
.ctx-dropzone { border:2px dashed #0D6E6E; border-radius:8px; background:#F0EFFF; padding:16px; text-align:center; font-size:11px; color:#0D6E6E; display:flex; align-items:center; justify-content:center; min-height:60px; cursor:pointer; } .ctx-dropzone.dragover { background:#e8e4ff; }
.ctx-preview { position:relative; text-align:center; margin-bottom:8px; } .ctx-img { max-width:180px; max-height:100px; border-radius:6px; border:1px solid #e2e8f0; } .ctx-remove { position:absolute; top:-6px; right:calc(50% - 96px); width:18px; height:18px; border-radius:50%; background:#FF3B30; color:#fff; border:none; font-size:11px; cursor:pointer; }
.alert-item { display:flex; align-items:center; padding:6px 8px; background:#FFF7ED; border:1px solid #FBBF24; border-radius:6px; margin-bottom:4px; font-size:11px; gap:6px; } .alert-time { font-size:10px; color:#92400E; margin-left:auto; } .alert-dismiss { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:14px; }
.tcpa-inline { padding:4px 14px 8px; font-size:11px; color:#9CA3AF; line-height:1.3; text-align:center; flex-shrink:0; }
/* Lead Capture */
.lead-btn { height:24px; padding:0 8px; border-radius:6px; border:1px solid #E5E7EB; background:#fff; color:${isVinSolutions ? '#9CA3AF' : '#0D6E6E'}; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; margin-right:4px; flex-shrink:0; white-space:nowrap; line-height:1; } .lead-btn:hover { background:#f3f4f6; }
.lead-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .lead-tab-btn.active { color:#0D6E6E; border-bottom-color:#0D6E6E; }
.lead-field { display:flex; flex-direction:column; gap:2px; margin-bottom:8px; } .lead-field label { font-size:10px; font-weight:600; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px; } .lead-field input { padding:6px 8px; border:1px solid #E5E7EB; border-radius:4px; font-size:13px; font-family:inherit; outline:none; color:#1a202c; } .lead-field input:focus { border-color:#0D6E6E; } .lead-field input.empty { background:#FEF08A; }
.lead-confidence { text-align:center; font-size:11px; color:#6B7280; margin-bottom:10px; padding:4px 8px; background:#f3f4f6; border-radius:4px; }
.lead-inject-btn { width:100%; padding:10px; background:#0D6E6E; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:4px; } .lead-inject-btn:hover { background:#0A5555; }
.lead-inject-btn.locked { background:#9CA3AF; cursor:not-allowed; } .lead-inject-btn.locked:hover { background:#9CA3AF; }
.lead-cancel-btn { width:100%; padding:8px; background:transparent; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; font-weight:500; color:#475569; cursor:pointer; font-family:inherit; margin-top:6px; } .lead-cancel-btn:hover { background:#f3f4f6; }
.lead-gate-msg { font-size:10px; color:#9CA3AF; text-align:center; margin-top:6px; }
.lead-banner { padding:8px 12px; background:#F0EFFF; border-bottom:1px solid #E5E7EB; cursor:pointer; font-size:12px; color:#0D6E6E; font-weight:600; display:flex; align-items:center; gap:6px; } .lead-banner:hover { background:#e8e4ff; }
/* Settings */
.settings-section { padding:16px 14px; } .settings-label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; margin-top:12px; }
.settings-options { display:flex; flex-direction:column; gap:6px; position:relative; } .settings-options label { font-size:12px; color:#1a202c; display:flex; align-items:center; gap:6px; } .settings-options input[type="radio"] { accent-color:#0D6E6E; }
${isGmail ? `
/* Gmail overrides */
#o8 { font-size:13px; border-radius:0; box-shadow:none; border:none; }
.header { border-radius:0; }
.quick-mode { overflow:auto; }
.input-section { padding:10px 12px; }
.chips { gap:4px; margin-bottom:8px; }
.chip { padding:4px 10px; font-size:11px; border-radius:14px; }
.main-input { padding:8px 36px 8px 10px; font-size:13px; }
.inline-mic { width:26px; height:26px; right:5px; top:5px; }
.gen-btn { padding:9px; font-size:13px; margin-top:8px; border-radius:6px; }
.inline-links { margin-top:6px; gap:5px; } .link-btn { font-size:11px; }
.tcpa-inline { padding:3px 12px 6px; }
.outputs { padding:6px 12px; overflow-y:auto; flex:1; min-height:0; }
.out-card { padding:8px 10px; margin-bottom:6px; }
.out-label { font-size:9px; margin-bottom:3px; }
.out-textarea { min-height:120px; max-height:300px; height:auto; font-size:11px; }
.out-actions { gap:5px; margin-top:5px; }
.out-action { padding:4px 12px; font-size:11px; }
` : ''}
${isLinkedIn ? `
/* LinkedIn overrides */
.input-section { padding:10px 12px; }
.chips { gap:4px; margin-bottom:8px; }
.chip { padding:4px 10px; font-size:11px; border-radius:14px; }
.gen-btn { padding:8px; font-size:13px; margin-top:6px; }
.inline-links { margin-top:6px; } .link-btn { font-size:10px; }
.tcpa-inline { padding:2px 12px 6px; font-size:8px; }
` : ''}
`;
    }

    // ===== NETWORK INTERCEPTION (VinSolutions) =====
    if (isVinSolutions) {
      try { const script = document.createElement('script'); script.src = browser.runtime.getURL('brevmont-intercept.js'); (document.head || document.documentElement).appendChild(script); script.onload = () => script.remove(); } catch(e) {}
      window.addEventListener('message', (event) => { if (event.data?.type === 'BREVMONT_LEAD_DATA' && event.data?.data?.customerName) { leadData = event.data.data; updateSidebar(); } });
    }
  },
});
