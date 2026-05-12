/**
 * Brevmont Content Script — Thin DOM Relay
 *
 * This file bridges the host page DOM and the Side Panel / Background.
 * It does NOT render any UI — all UI lives in the Chrome Side Panel.
 *
 * Responsibilities:
 * 1. Platform detection
 * 2. VinSolutions DOM scanning (customer name, phone, email, vehicle)
 * 3. DOM injection (paste generated text into host page inputs)
 * 4. Message listener (bridge between Side Panel ↔ host page DOM)
 * 5. VinSolutions popup injection (email, call log, text message popups)
 * 6. Network interception (brevmont-intercept.js)
 */

import { selectorManager, type SelectorEntry } from './lib/selectors';
import { dlog } from './lib/dev';
import { addBreadcrumb } from '../lib/breadcrumbs';
import { extractContactName as extractContactNameForPlatform, gatherAllText } from './lib/leadContextScan';

type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

export default defineContentScript({
  matches: [
    '*://*.vinsolutions.com/*',
    '*://vinsolutions.app.coxautoinc.com/*',
    '*://mail.google.com/*',
    '*://*.facebook.com/*',
    '*://www.facebook.com/messages/*',
    '*://www.facebook.com/marketplace/t/*',
    '*://*.messenger.com/*',
    '*://www.messenger.com/*',
    '*://*.linkedin.com/*',
    '*://www.linkedin.com/*',
    '*://*.instagram.com/*',
    '*://www.instagram.com/direct/*',
    '*://www.instagram.com/direct/t/*',
    '*://web.whatsapp.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    // ===== PLATFORM DETECTION =====
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

    // ===== KILL SWITCH =====
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

    // ===== VERSION GATE =====
    try {
      const vs = await browser.storage.local.get('brevmont_version_status');
      const status = vs?.brevmont_version_status as { locked?: boolean; forceUpdate?: boolean; latest?: string; message?: string; downloadUrl?: string } | undefined;
      const forceUpdate = Boolean(status?.forceUpdate || status?.locked);
      if (forceUpdate && document.body && !document.getElementById('brevmont-version-lock')) {
        const overlay = document.createElement('div');
        overlay.id = 'brevmont-version-lock';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,20,25,0.92);display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;';
        overlay.innerHTML = `
          <div style="max-width:480px;background:#F8F6F1;color:#0F1419;border-radius:16px;padding:32px 28px;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
            <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#0D6E6E;margin-bottom:12px;font-weight:700;">BREVMONT UPDATE REQUIRED</div>
            <h2 style="font-size:22px;font-weight:800;margin:0 0 10px;line-height:1.25;">Please update the extension</h2>
            <p style="font-size:14px;line-height:1.55;margin:0 0 18px;color:#3A3F43;">${status.message || 'This version of Brevmont is no longer supported.'}</p>
            <p style="font-size:12px;line-height:1.5;margin:0 0 20px;color:#5A6066;">Download the latest build, then reload this page.</p>
            <button id="brevmont-version-lock-download" style="background:#0D6E6E;border:0;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Download latest</button>
          </div>
        `;
        document.body.appendChild(overlay);
        const download = document.getElementById('brevmont-version-lock-download');
        if (download) download.addEventListener('click', () => {
          window.open(status.downloadUrl || 'https://api.brevmont.com/api/extension-download', '_blank', 'noopener');
        });
        return;
      }
    } catch (_err) {
      // Version-status read fails → behave as if unlocked
    }

    const isVinSolutions = PLATFORM === 'vinsolutions';
    const isGmail = PLATFORM === 'gmail';
    const isFacebook = PLATFORM === 'facebook';
    const isLinkedIn = PLATFORM === 'linkedin';
    const isInstagram = PLATFORM === 'instagram';

    // ===== STATE =====
    let leadData: any = null;

    // ===== CLEANUP REGISTRY =====
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
      while (__CLEANUP.length) { try { __CLEANUP.pop()?.(); } catch {} }
    }
    try { window.addEventListener('beforeunload', __cleanupAll); } catch {}
    try { window.addEventListener('pagehide', __cleanupAll); } catch {}
    const addInterval = __addInterval;
    const addObserver = __addObserver;

    // ===== REMOTE SELECTORS =====
    let vinSelectors: SelectorEntry[] = [];
    let gmailSelectors: SelectorEntry[] = [];
    if (isVinSolutions) {
      selectorManager.getSelectors('vinsolutions').then(sel => { vinSelectors = sel || []; }).catch(() => {});
    }
    if (isGmail) {
      selectorManager.getSelectors('gmail').then(sel => { gmailSelectors = sel || []; }).catch(() => {});
    }

    function qSel(selectors: SelectorEntry[], purpose: string, hardcoded: string, root: Document | HTMLElement = document): Element | null {
      try {
        if (selectors && selectors.length) {
          const el = selectorManager.query(selectors, purpose, root);
          if (el) return el;
        }
      } catch {}
      try { return (root as Document).querySelector(hardcoded); } catch { return null; }
    }

    // ===== HELPERS =====
    function safeExtractContactName(): string | null {
      try { return extractContactNameForPlatform(PLATFORM) || null; } catch { return null; }
    }

    function extractGmailLeadSignal(rawText: string): { customerName?: string | null; email?: string | null; rawPrefix?: string } {
      if (!isGmail) return {};
      const candidates = Array.from(document.querySelectorAll('.gD[email], .gD[data-hovercard-id], [email], [data-hovercard-id]')) as HTMLElement[];
      let senderEl = candidates.find(el => {
        const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
        return /@/.test(email);
      }) || null;

      if (!senderEl) {
        senderEl = document.querySelector('[aria-label*="@"][role="button"], [title*="@"]') as HTMLElement | null;
      }

      const attrEmail = senderEl?.getAttribute('email')
        || senderEl?.getAttribute('data-hovercard-id')
        || senderEl?.getAttribute('title')?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
        || rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
        || null;

      const attrName = senderEl?.getAttribute('name')
        || senderEl?.getAttribute('data-name')
        || senderEl?.textContent?.replace(/<[^>]+>/g, '').trim()
        || null;

      const cleanName = attrName
        ? attrName
            .replace(attrEmail || '', '')
            .replace(/[<>"()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : null;
      const emailLocalName = attrEmail
        ? attrEmail.split('@')[0].replace(/[._+-]+/g, ' ').replace(/\s+/g, ' ').trim()
        : null;
      const customerName = cleanName || safeExtractContactName() || emailLocalName;
      const rawPrefix = [
        customerName ? `Sender name: ${customerName}` : '',
        attrEmail ? `Sender email: ${attrEmail}` : '',
      ].filter(Boolean).join('\n');

      return { customerName, email: attrEmail, rawPrefix };
    }

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

    function esc(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== TELEMETRY =====
    let _logErrorCount = 0;
    const _LOG_ERROR_MAX = 20;
    function logError(errorType: string, errorMessage: string, context?: string) {
      if (_logErrorCount >= _LOG_ERROR_MAX) return;
      _logErrorCount++;
      try {
        browser.runtime.sendMessage({
          type: 'REPORT_ERROR',
          payload: { error_type: errorType, error_message: errorMessage, context }
        }).catch(() => {});
      } catch(e) { /* extension context invalidated */ }
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
      if (!v) { const sh = text.match(/(?:Sold|Active|Lost)\s+[\s\S]{0,60}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i); if (sh) v = sh[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      if (!v) { const voi = text.match(/Vehicle(?:\(s\))?\s*of\s*Interest\s*[\s\S]{0,60}?(20\d{2}\s+\w+(?:\s+\w+){0,4})/i); if (voi) v = voi[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      if (!v) { const si = text.match(/Sale\s*Info\s*[\s\S]{0,200}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i); if (si) v = si[1].trim().replace(/\s+/g, ' ').slice(0, 50); }
      if (!v) {
        const nameMatch = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
        if (nameMatch) {
          const afterName = text.slice(nameMatch.index! + nameMatch[0].length, nameMatch.index! + nameMatch[0].length + 800);
          const nearby = afterName.match(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')\\s+[A-Za-z0-9 /-]+)', 'i'));
          if (nearby) v = nearby[1].trim().replace(/\s+/g, ' ').replace(/\s*\[.*$/, '').slice(0, 50);
        }
      }
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
          if (/20\d{2}/.test(val)) return val.slice(0, 60);
        }
      }
      return null;
    }

    function deepTableVehicleSearch(): string | null {
      function searchDoc(doc: Document): string | null {
        const fromTable = extractVehicleFromTable(doc);
        if (fromTable) return fromTable;
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
      let name = '';
      const labelName = extractByLabel('Customer Dashboard');
      if (labelName) name = labelName;
      if (!name) { const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/); if (dm) name = dm[1].trim(); }
      if (!name) { const im = text.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/); if (im) name = im[1].trim(); }
      let phone = ''; const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/); if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');
      let email = ''; const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/); if (em) email = em[0];
      if (!email) {
        const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
        for (const link of mailtoLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href) { email = href.replace('mailto:', '').split('?')[0]; break; }
        }
      }
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
      let vehicle: string | null = deepTableVehicleSearch() || extractByLabel('Vehicle') || null;
      if (!vehicle) vehicle = extractVehicle(text) || null;
      let source = ''; const sm = text.match(/Source:\s*(.+)/i); if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
      let status = ''; const stm = text.match(/Status:\s*(.+)/i); if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
      let lastContact = ''; const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i); if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
      return { customerName: name, phone, email, vehicle, source, status, lastContact };
    }

    // Only inject in top frame
    if (window !== window.top) return;

    // ===== POPUP INJECTION FUNCTIONS (VinSolutions only) =====

    async function injectEmailComposeButton() {
      await new Promise(r => setTimeout(r, 2500));

      function findEditorIframe(): HTMLIFrameElement | null {
        try {
          const remote = qSel(vinSelectors, 'ckeditor_iframe', 'iframe.cke_wysiwyg_frame') as HTMLIFrameElement | null;
          if (remote) return remote;
        } catch {}
        const selectors = [
          'iframe.cke_wysiwyg_frame', 'iframe[id*="Editor"]', 'iframe[id*="editor"]',
          'iframe[id*="cke_"]', 'iframe[title*="Rich Text"]', 'iframe[title*="editor"]',
          '.cke_contents iframe', '[id*="cke_contents"] iframe',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLIFrameElement;
          if (el) { dlog('[Brevmont] Found editor iframe via:', sel); return el; }
        }
        const allIframes = document.querySelectorAll('iframe');
        for (const iframe of allIframes) {
          const src = iframe.getAttribute('src') || '';
          if (!src || src === 'about:blank' || src === 'javascript:void(0)') {
            try {
              const doc = (iframe as HTMLIFrameElement).contentDocument;
              if (doc?.body?.contentEditable === 'true' || doc?.designMode === 'on') {
                return iframe as HTMLIFrameElement;
              }
            } catch(e) {}
          }
        }
        return null;
      }

      const subjectInput = qSel(vinSelectors, 'email_subject_input', 'input[id*="subject"], input[id*="Subject"], input[name*="subject"], input[name*="Subject"]') as HTMLInputElement;

      const btn = document.createElement('button');
      btn.textContent = 'Generate with Brevmont';
      btn.id = 'brevmont-email-generate';
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
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = 'Generating...'; btn.disabled = true;

        try {
          const customerEl = document.querySelector('[id*="customer"], [id*="CustomerName"], [id*="name"], .customer-name, h1, h2, [class*="header"] span');
          const customerName = customerEl?.textContent?.trim() || '';
          const toField = qSel(vinSelectors, 'email_to_input', 'input[id*="to"], input[id*="To"], input[name*="to"], input[type="email"]') as HTMLInputElement;
          const toEmail = toField?.value || '';

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

          const subjectMatch = raw.match(/Subject:\s*(.+?)(?:\n|$)/i);
          const emailBody = raw.replace(/^(?:EMAIL\s*\n)?Subject:\s*.+?\n\n?/i, '').trim();

          if (subjectInput && subjectMatch?.[1]) {
            safeInjectText(subjectInput, subjectMatch[1].trim());
          }

          const editorFrame = findEditorIframe();
          if (editorFrame) {
            try {
              const innerDoc = editorFrame.contentDocument || editorFrame.contentWindow?.document;
              if (innerDoc) {
                if (innerDoc.readyState !== 'complete') {
                  await new Promise(r => setTimeout(r, 500));
                }
                const htmlBody = emailBody.split('\n').filter((l: string) => l.trim()).map((p: string) => `<p>${p}</p>`).join('');
                const existingHTML = innerDoc.body.innerHTML || '';
                const looksEmpty = !existingHTML.trim() || existingHTML === '<p>&nbsp;</p>' || existingHTML === '<br>';
                if (looksEmpty) {
                  innerDoc.body.innerHTML = htmlBody;
                } else {
                  const marker = '<!--brevmont-generated-start-->';
                  const endMarker = '<!--brevmont-generated-end-->';
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
              }
            } catch(frameErr: any) {
              logError('DOM_ERROR', frameErr.message || 'Iframe write failed', 'email_iframe_inject');
              try {
                editorFrame.contentWindow?.focus();
                const innerDoc = editorFrame.contentDocument;
                if (innerDoc) {
                  innerDoc.execCommand('selectAll', false);
                  innerDoc.execCommand('insertHTML', false, emailBody.split('\n').filter((l: string) => l.trim()).map((p: string) => `<p>${p}</p>`).join(''));
                }
              } catch(cmdErr: any) {
                console.error('[Brevmont] execCommand fallback failed:', cmdErr.message);
              }
            }
          } else {
            const bodyTextarea = document.querySelector('textarea[id*="body"], textarea[id*="Body"], textarea[id*="content"], textarea[name*="body"]') as HTMLTextAreaElement;
            if (bodyTextarea) {
              safeInjectText(bodyTextarea, emailBody);
            } else {
              navigator.clipboard.writeText(emailBody);
              const toast = document.createElement('div');
              toast.textContent = 'Email copied to clipboard. Paste into body field.';
              Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#C4841D', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 4000);
            }
          }

          const toast = document.createElement('div');
          toast.textContent = 'Email generated. Review and send.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);

          btn.textContent = 'Generate with Brevmont'; btn.disabled = false;
        } catch(e: any) {
          logError('API_ERROR', e.message || 'Email popup generation failed', 'vinsolutions_email_popup');
          btn.textContent = 'Error. Try again.'; btn.disabled = false;
          setTimeout(() => { btn.textContent = 'Generate with Brevmont'; }, 2000);
        }
      });
    }

    async function injectCallLogButton() {
      await new Promise(r => setTimeout(r, 2000));

      function findNotesField(): HTMLTextAreaElement | null {
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
        const allTextareas = document.querySelectorAll('textarea');
        if (allTextareas.length === 1) return allTextareas[0] as HTMLTextAreaElement;
        let biggest: HTMLTextAreaElement | null = null;
        let maxArea = 0;
        allTextareas.forEach(ta => {
          const rect = (ta as HTMLElement).getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > maxArea) { maxArea = area; biggest = ta as HTMLTextAreaElement; }
        });
        return biggest;
      }

      const notesField = findNotesField();
      if (!notesField) return;

      const btn = document.createElement('button');
      btn.textContent = 'Generate Call Note';
      btn.id = 'brevmont-callnote-generate';
      btn.type = 'button';
      Object.assign(btn.style, {
        background: '#0D6E6E', color: '#fff', border: 'none', borderRadius: '8px',
        padding: '6px 14px', fontSize: '12px', fontWeight: '600', fontFamily: 'system-ui,sans-serif',
        cursor: 'pointer', margin: '4px 0', whiteSpace: 'nowrap', display: 'block'
      });
      btn.onmouseenter = () => { btn.style.background = '#0A5555'; };
      btn.onmouseleave = () => { btn.style.background = '#0D6E6E'; };
      notesField.parentElement?.insertBefore(btn, notesField);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = 'Generating...'; btn.disabled = true;

        try {
          const customerEl = document.querySelector('[id*="customer"], [id*="CustomerName"], [id*="name"], .customer-name, h1, h2');
          const customerName = customerEl?.textContent?.trim() || '';

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
          note = note.replace(/^CRM\s*NOTE\s*\n?/i, '').trim();

          safeInjectText(notesField, note);
          notesField.dispatchEvent(new Event('input', { bubbles: true }));
          notesField.dispatchEvent(new Event('change', { bubbles: true }));
          notesField.dispatchEvent(new Event('blur', { bubbles: true }));

          const toast = document.createElement('div');
          toast.textContent = 'Call note generated.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);

          btn.textContent = 'Generate Call Note'; btn.disabled = false;
        } catch(e: any) {
          btn.textContent = 'Error. Try again.'; btn.disabled = false;
          logError('API_ERROR', e?.message || 'Call log generation failed', 'vinsolutions_call_log');
          setTimeout(() => { btn.textContent = 'Generate Call Note'; }, 2000);
        }
      });
    }

    async function injectTextMessageButton() {
      await new Promise(r => setTimeout(r, 1500));

      function findMessageField(): HTMLTextAreaElement | HTMLInputElement | null {
        const byId = document.querySelector(
          'textarea[id*="message" i], textarea[id*="body" i], textarea[name*="message" i], textarea[name*="body" i]'
        ) as HTMLTextAreaElement | null;
        if (byId) return byId;
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
      if (!field) return;

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
          logError('API_ERROR', err?.message || 'Text popup generation failed', 'vinsolutions_text_popup');
          setTimeout(() => { btn.textContent = 'Generate with Brevmont'; }, 2000);
        }
      });
    }

    // ===== VINSOLUTIONS POPUP HANDLER =====
    if (isVinSolutions) {
      const popupUrl = window.location.href.toLowerCase();
      if (popupUrl.includes('sendemail.aspx') || popupUrl.includes('communication') && popupUrl.includes('email')) {
        dlog('[Brevmont] Email compose popup detected');
        injectEmailComposeButton();
        return;
      }
      if (popupUrl.includes('logcallv2') || popupUrl.includes('logcall')) {
        dlog('[Brevmont] Call log popup detected');
        injectCallLogButton();
        return;
      }
      if (popupUrl.includes('rims2') && (popupUrl.includes('texting') || popupUrl.includes('vinwfetexting') || popupUrl.includes('textmessage'))) {
        dlog('[Brevmont] Text message popup detected');
        injectTextMessageButton();
        return;
      }
    }

    // ===== WAIT FOR VINSOLUTIONS PAGE READY =====
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

    dlog(`[Brevmont] Relay active — platform: ${PLATFORM}, isTop: ${window === window.top}`);

    // ===== VINSOLUTIONS SCANNING (top frame only) =====
    if (isVinSolutions) {
      function gatherAllText(): string {
        let text = document.body?.innerText || '';
        function readIframes(doc: Document) {
          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of iframes) {
            try {
              const d = (iframe as HTMLIFrameElement).contentDocument || (iframe as any).contentWindow?.document;
              if (d?.body) {
                text += '\n' + d.body.innerText;
                readIframes(d);
              }
            } catch(e) {}
          }
        }
        readIframes(document);
        return text;
      }

      function getDashboardScopedText(): string {
        const full = gatherAllText();
        const idx = full.search(/Customer Dashboard/i);
        if (idx === -1) return '';
        return full.slice(idx);
      }

      function attemptScan() {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) return;
        const s = scanText(dashText);
        if (!s.vehicle) {
          s.vehicle = deepTableVehicleSearch() || null;
        }
        if (!s.vehicle) {
          const allText = gatherAllText();
          s.vehicle = extractVehicle(allText) || null;
        }
        if (s.customerName) {
          const allPageText = gatherAllText();
          if (!allPageText.includes(s.customerName)) return;
          leadData = s;
          browser.storage.local.set({ brevmont_lead: s, brevmont_lead_time: Date.now() });
        }
        if (s.vehicle) browser.storage.local.set({ brevmont_vehicle_info: s.vehicle, brevmont_vehicle_info_time: Date.now() });
      }
      attemptScan();
      let lastScannedName = '';

      // ===== PERIODIC RESCAN (every 2s) =====
      addInterval(() => {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) {
          if (leadData) {
            leadData = null;
            lastScannedName = '';
            browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
          }
          return;
        }
        const nm = dashText.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/)
          || dashText.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) {
          dlog(`[Brevmont] Customer changed: "${lastScannedName}" → "${curName}"`);
          lastScannedName = curName;
          leadData = null;
          browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
          attemptScan();
          setTimeout(() => { attemptScan(); }, 1500);
        } else if (curName && leadData?.customerName === curName && !leadData?.vehicle) {
          const v = deepTableVehicleSearch();
          if (v) {
            leadData.vehicle = v;
            browser.storage.local.set({ brevmont_lead: leadData, brevmont_lead_time: Date.now(), brevmont_vehicle_info: v, brevmont_vehicle_info_time: Date.now() });
          }
        }
      }, 2000);

      // MutationObserver for fast detection
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
          }
        }, 500);
      });
      const mainPanel = qSel(vinSelectors, 'main_panel', '#mainAreaPanel') || document.body;
      addObserver(vinObserver, mainPanel, { childList: true, subtree: true, characterData: true });

      // ===== VinSolutions SPA NAVIGATION OBSERVER =====
      let lastVinUrl = window.location.href;
      let spaRescanTimer: ReturnType<typeof setTimeout> | null = null;
      const vinUrlObserver = new MutationObserver(() => {
        if (window.location.href !== lastVinUrl) {
          lastVinUrl = window.location.href;
          leadData = null;
          lastScannedName = '';
          browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);

          if (spaRescanTimer) clearTimeout(spaRescanTimer);
          spaRescanTimer = setTimeout(() => {
            validatedScan(0);
          }, 1500);
        }
      });
      addObserver(vinUrlObserver, document.body, { childList: true, subtree: true });

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
        if (s.customerName) {
          const pageText = document.body?.innerText || '';
          if (!pageText.includes(s.customerName)) {
            if (attempt < 5) setTimeout(() => validatedScan(attempt + 1), 500);
            return;
          }
          leadData = s;
          lastScannedName = s.customerName;
          browser.storage.local.set({ brevmont_lead: s, brevmont_lead_time: Date.now() });
          if (s.vehicle) browser.storage.local.set({ brevmont_vehicle_info: s.vehicle, brevmont_vehicle_info_time: Date.now() });
        } else if (attempt < 5) {
          setTimeout(() => validatedScan(attempt + 1), 500);
        }
      }

      // ===== DOM DISCOVERY TELEMETRY =====
      setTimeout(() => {
        try {
          const pageKey = `brevmont_dom_disc_${window.location.pathname}`;
          if ((window as any)[pageKey]) return;
          (window as any)[pageKey] = true;
          const iframes = Array.from(document.querySelectorAll('iframe')).slice(0, 20).map(f => ({
            src: (f.src || '').slice(0, 200), id: f.id || null, name: f.name || null,
          }));
          const ids = Array.from(document.querySelectorAll('[id]')).slice(0, 50).map(el => ({
            id: el.id, tag: el.tagName.toLowerCase(),
          }));
          const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(f => ({
            action: (f.action || '').slice(0, 200), id: f.id || null,
            inputs: Array.from(f.querySelectorAll('input, textarea, select')).slice(0, 15).map(i => ({
              name: (i as HTMLInputElement).name || null, id: i.id || null, type: (i as HTMLInputElement).type || i.tagName.toLowerCase(),
            })),
          }));
          browser.runtime.sendMessage({
            type: 'TELEMETRY_DOM_DISCOVERY',
            payload: { url_path: window.location.pathname, page_title: document.title?.slice(0, 200) || '', platform: PLATFORM, iframes, ids, forms }
          }).catch(() => {});
        } catch { /* never crash */ }
      }, 5000);
    }

    // ===== NON-VINSOLUTIONS CONTACT NAME WATCHER =====
    if (!isVinSolutions) {
      addInterval(() => {
        const name = extractContactNameForPlatform(PLATFORM);
        if (name && (!leadData || !leadData.customerName)) {
          leadData = leadData || {};
          leadData.customerName = name;
          if (isGmail) {
            const emailEl = qSel(gmailSelectors, 'sender_email_badge', '.gD');
            if (emailEl) {
              const emailAddr = emailEl.getAttribute('email');
              if (emailAddr) leadData.email = emailAddr;
            }
          }
          dlog('[Brevmont] Auto-captured contact:', name);
        } else if (name && leadData && leadData.customerName && leadData.customerName !== name) {
          leadData.customerName = name;
          if (isGmail) {
            const emailEl = qSel(gmailSelectors, 'sender_email_badge', '.gD');
            if (emailEl) leadData.email = emailEl.getAttribute('email') || leadData.email;
          }
          dlog('[Brevmont] Contact name updated to:', name);
        } else if (!name && leadData && leadData.customerName) {
          dlog('[Brevmont] Extractor returned null — clearing stale leadData name', leadData.customerName);
          leadData.customerName = null;
          if (isGmail) leadData.email = null;
        }
      }, 3000);
    }

    // ===== CRM PASTE FUNCTIONS (VinSolutions) =====
    function findNoteTextarea(): HTMLTextAreaElement | null {
      if (!isVinSolutions) return null;
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.src?.includes('AddNote')) {
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (doc) { const ta = doc.querySelector('textarea'); if (ta) return ta; }
          }
        } catch(e) {}
      }
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
          if (!doc) continue;
          if ((doc.body?.innerText || '').includes('Add Note') || (doc.body?.innerText || '').includes('Note Type')) {
            const ta = doc.querySelector('textarea');
            if (ta) return ta;
          }
        } catch(e) {}
      }
      return null;
    }

    function clickNoteIcon(): boolean {
      if (!isVinSolutions) return false;
      for (const el of document.querySelectorAll('a, button, div, span, td')) {
        if (el.textContent?.trim() === 'Note' && (el as HTMLElement).offsetWidth > 0) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }

    async function pasteIntoCRM(noteText: string): Promise<boolean> {
      if (!isVinSolutions) return false;
      await browser.storage.local.set({ brevmont_paste_note: noteText, brevmont_paste_note_time: Date.now() });
      let textarea = findNoteTextarea();
      if (!textarea) {
        const clicked = clickNoteIcon();
        if (clicked) {
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 500));
            textarea = findNoteTextarea();
            if (textarea) break;
          }
        }
      }
      if (textarea) {
        textarea.focus();
        safeInjectText(textarea, noteText);
        textarea.style.border = '2px solid #16a34a';
        setTimeout(() => { textarea!.style.border = ''; }, 2000);
        browser.storage.local.remove(['brevmont_paste_note', 'brevmont_paste_note_time']);
        return true;
      } else {
        try {
          browser.runtime.sendMessage({
            type: 'SAVE_PENDING_NOTE',
            payload: { customer_name: leadData?.customerName || safeExtractContactName() || '', note_text: noteText, contact_id: null }
          });
        } catch(e) {}
        return false;
      }
    }

    // ===== INJECT CONTENT (Side Panel → host page DOM) =====
    function injectContent(parsed: any): boolean {
      const { action, content, subject } = parsed;
      if ((action === 'write_email' || PLATFORM === 'gmail') && isGmail) { const body = qSel(gmailSelectors, 'compose_body', 'div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement; if (body) { body.focus(); safeInjectText(body, content); if (subject) { const subj = qSel(gmailSelectors, 'compose_subject', 'input[name="subjectbox"]') as HTMLInputElement; if (subj) { subj.focus(); safeInjectText(subj, subject); } } return true; } }
      if ((action === 'write_facebook_message' || PLATFORM === 'facebook') && isFacebook) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if ((action === 'write_linkedin_message' || PLATFORM === 'linkedin') && isLinkedIn) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if (PLATFORM === 'whatsapp') { const box = document.querySelector('div[contenteditable="true"][data-tab="10"]') as HTMLElement ?? document.querySelector('footer div[contenteditable="true"]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if (isInstagram) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement ?? document.querySelector('textarea[placeholder]') as HTMLElement; if (box) { box.focus(); safeInjectText(box, content); return true; } }
      if (action === 'log_crm_note' && isVinSolutions) { pasteIntoCRM(content); return true; }
      return false;
    }

    // ===== MESSAGE LISTENER (Side Panel + Background bridge) =====
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

      if (msg.type === 'GET_LEAD_CONTEXT') {
        try {
          sendResponse({
            customerName: leadData?.customerName || safeExtractContactName() || null,
            vehicle: leadData?.vehicle || null,
            phone: leadData?.phone || null,
            email: leadData?.email || null,
            source: leadData?.source || null,
            vehicleMake: leadData?.vehicleMake || null,
            vehicleModel: leadData?.vehicleModel || null,
            vehicleOfInterest: leadData?.vehicleOfInterest || leadData?.vehicle || null,
            platform: PLATFORM,
            leadCreatedAt: scrapeLeadCreatedAt(),
          });
        } catch {
          sendResponse({ platform: PLATFORM });
        }
        return false;
      }

      if (msg.type === 'GET_SIDEBAR_STATE') {
        sendResponse({ platform: PLATFORM, sidebarOpen: false, hasLead: !!(leadData?.customerName) });
        return false;
      }

      if (msg.type === 'SCAN_LEAD') {
        try {
          let rawText = '';
          if (isFacebook) {
            const main = document.querySelector('[role="main"]') as HTMLElement | null;
            rawText = main?.innerText || document.body?.innerText || '';
          } else if (isLinkedIn) {
            const thread = document.querySelector('.msg-s-message-list-content, [class*="msg-thread"], [class*="message-list"], .msg-conversations-container__thread-view, [class*="scaffold-layout__detail"]') as HTMLElement | null;
            rawText = thread?.innerText || document.body?.innerText || '';
          } else if (isGmail) {
            const msgEl = document.querySelector('.h7, [role="list"], .a3s') as HTMLElement | null;
            rawText = msgEl?.innerText || document.body?.innerText || '';
          } else if (isInstagram) {
            const thread = document.querySelector('[role="main"]') as HTMLElement | null;
            rawText = thread?.innerText || document.body?.innerText || '';
          } else {
            rawText = gatherAllText();
          }
          rawText = (rawText || '').slice(0, 5000);
          const gmailSignal = extractGmailLeadSignal(rawText);
          if (gmailSignal.rawPrefix) {
            rawText = `${gmailSignal.rawPrefix}\n\n${rawText}`.slice(0, 5000);
          }
          const scanned = isVinSolutions ? scanText(rawText) : {};
          const name = scanned.customerName || leadData?.customerName || gmailSignal.customerName || safeExtractContactName();
          const phone = scanned.phone || leadData?.phone || null;
          const email = scanned.email || leadData?.email || gmailSignal.email || null;
          const vehicle = scanned.vehicle || leadData?.vehicle || leadData?.vehicleOfInterest || null;
          sendResponse({
            name: name || null,
            customerName: name || null,
            customer_name: name || null,
            phone,
            email,
            vehicle,
            vehicle_interest: vehicle,
            source: scanned.source || leadData?.source || null,
            status: scanned.status || leadData?.status || null,
            lastContact: scanned.lastContact || leadData?.lastContact || null,
            platform: PLATFORM,
            raw_text: rawText,
            source_raw_text: rawText,
          });
        } catch {
          sendResponse({ name: null, customerName: null, platform: PLATFORM });
        }
        return false;
      }

      if (msg.type === 'INJECT_CONTENT') {
        try {
          const { content, outputType } = msg.payload || {};
          const mapped: any = {
            action: outputType === 'email' ? 'write_email' : outputType === 'crm' ? 'log_crm_note' : 'write_message',
            content: content || '',
          };
          const ok = injectContent(mapped);
          if (!ok) {
            navigator.clipboard.writeText(content || '').catch(() => {});
          }
          sendResponse({ ok });
        } catch (e: any) {
          sendResponse({ ok: false, error: e.message });
        }
        return false;
      }

      if (msg.type === 'SHOW_ALERT_BANNER') {
        const existing = document.getElementById('brevmont-alert-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.id = 'brevmont-alert-banner';
        Object.assign(banner.style, {
          position:'fixed', top:'0', left:'0', right:'0', zIndex:'999999',
          background:'#0F1419', color:'#F8F6F1', padding:'12px 20px',
          fontFamily:'Inter, sans-serif', fontSize:'14px', fontWeight:'600',
          display:'flex', alignItems:'center', gap:'10px',
          boxShadow:'0 2px 8px rgba(0,0,0,0.2)'
        });
        banner.innerHTML = `<span style="flex:1">${esc(msg.payload.task)}</span><button style="background:#0D6E6E;border:none;color:#F8F6F1;padding:6px 16px;border-radius:6px;font-family:Inter,sans-serif;font-size:12px;font-weight:600;cursor:pointer">Dismiss</button>`;
        banner.querySelector('button')!.addEventListener('click', () => {
          banner.remove();
          browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id: msg.payload.id } });
        });
        document.body.appendChild(banner);
      }

      // GET_CONVERSATION_TEXT — returns raw visible text for generation context
      if (msg.type === 'GET_CONVERSATION_TEXT') {
        try {
          let text = '';
          if (isFacebook) {
            const main = document.querySelector('[role="main"]');
            text = main ? main.innerText.slice(0, 1500) : document.body.innerText.slice(0, 1500);
          } else if (isLinkedIn) {
            const thread = document.querySelector('.msg-s-message-list-content, [class*="msg-thread"], [class*="message-list"], .msg-conversations-container__thread-view, [class*="scaffold-layout__detail"]');
            text = thread ? (thread as HTMLElement).innerText.slice(0, 2000) : document.body.innerText.slice(0, 1500);
          } else if (isGmail) {
            const msgEl = document.querySelector('.h7, [role="list"], .a3s');
            text = msgEl ? (msgEl as HTMLElement).innerText.slice(0, 2000) : document.body.innerText.slice(0, 1500);
          } else if (isInstagram) {
            const thread = document.querySelector('[role="main"]');
            text = thread ? (thread as HTMLElement).innerText.slice(0, 1500) : document.body.innerText.slice(0, 1500);
          } else {
            text = document.body.innerText.slice(0, 1500);
          }
          sendResponse({ text });
        } catch {
          sendResponse({ text: '' });
        }
        return false;
      }
    });

    // ===== NETWORK INTERCEPTION (VinSolutions) =====
    if (isVinSolutions) {
      try {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL('brevmont-intercept.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
      } catch(e) {}
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'BREVMONT_LEAD_DATA' && event.data?.data?.customerName) {
          leadData = event.data.data;
        }
      });
    }

    // ===== NOTIFY READY =====
    browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', payload: { platform: PLATFORM } }).catch(() => {});
  },
});
