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
import { extractContactName as extractContactNameForPlatform, gatherAllText, hasActiveComposeSurface, isChannelOrUiName } from './lib/leadContextScan';
import { detectCustomerFromPage } from './lib/customerDetection';
import { trimCrmNoteForCompatibility } from './lib/crmNote';

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
      : _url.includes('facebook.com') ? 'facebook'
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

    function clearLeadContextCache(reason: string) {
      if (leadData) dlog(`[Brevmont] Clearing lead context cache: ${reason}`);
      leadData = null;
      browser.storage.local.remove(['brevmont_lead', 'brevmont_lead_time', 'brevmont_vehicle_info', 'brevmont_vehicle_info_time']);
    }

    function showHostToast(message: string, tone: 'info' | 'warn' = 'info') {
      try {
        const toast = document.createElement('div');
        toast.textContent = message;
        Object.assign(toast.style, {
          position: 'fixed',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: tone === 'warn' ? '#C4841D' : '#0F1419',
          color: '#fff',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: '500',
          zIndex: '2147483647',
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
      } catch {}
    }

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

    const AUTO_MAKES_RE = 'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';

    function stableHash(value: string): string {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function compactFingerprintText(value: unknown, max = 2200): string {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
    }

    function buildContextFingerprint(input: { name?: string | null; vehicle?: string | null; rawText?: string | null; method?: string | null } = {}) {
      const mainText = compactFingerprintText(input.rawText || (document.querySelector('[role="main"]') as HTMLElement | null)?.innerText || document.body?.innerText || '');
      const name = compactFingerprintText(input.name || extractFacebookConversationName() || safeExtractContactName() || '', 120).toLowerCase();
      const vehicle = compactFingerprintText(input.vehicle || extractVehicle(`${document.title}\n${mainText}`) || '', 120).toLowerCase();
      const basis = [
        PLATFORM,
        window.location.origin,
        window.location.pathname,
        name,
        vehicle,
        compactFingerprintText(document.title, 160).toLowerCase(),
        mainText.slice(0, 900).toLowerCase(),
      ].join('|');
      const fingerprint = `${PLATFORM}:${stableHash(basis)}`;
      return {
        context_fingerprint: fingerprint,
        thread_fingerprint: fingerprint,
        detected_at: new Date().toISOString(),
        detection_source: input.method || 'content_scan',
        raw_vehicle_evidence: vehicle || null,
      };
    }

    function cleanFacebookNameCandidate(value: string | null | undefined, options: { allowSingleName?: boolean } = {}): string | null {
      const cleaned = String(value || '')
        .replace(/\(\d+\)\s*/g, '')
        .replace(/\s+\|\s+(?:Messenger|Facebook).*$/i, '')
        .replace(/\s+-\s+(?:Messenger|Facebook).*$/i, '')
        .replace(/\s*[·•-]\s*(?:19|20)\d{2}\b.*$/i, '')
        .replace(/\b(?:created this group|sent a photo|sent an attachment|is waiting for your response)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned || cleaned.length < 2 || cleaned.length > 60 || cleaned.includes('@')) return null;
      if (/^(?:messenger|facebook|marketplace|chats|search messenger|brevmont|save lead|scan this page)$/i.test(cleaned)) return null;
      const namePattern = options.allowSingleName
        ? /^[A-Z][A-Za-z'-]{1,24}(?:\s+[A-Z][A-Za-z'-]{1,24}){0,3}$/
        : /^[A-Z][A-Za-z'-]{1,24}\s+[A-Z][A-Za-z'-]{1,24}(?:\s+[A-Z][A-Za-z'-]{1,24}){0,2}$/;
      if (!namePattern.test(cleaned)) return null;
      return cleaned;
    }

    function extractFacebookConversationName(): string | null {
      if (!isFacebook) return null;
      const titleName = cleanFacebookNameCandidate(document.title, { allowSingleName: true });
      if (titleName) return titleName;

      for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
        const label = el.getAttribute('aria-label') || '';
        const match = label.match(/(?:Conversation with|Profile picture of|Open profile for|Message)\s+([^,|]+)/i);
        const candidate = cleanFacebookNameCandidate(match?.[1] || null, { allowSingleName: true });
        if (candidate) return candidate;
      }

      const selectors = [
        '[role="main"] [role="heading"]',
        '[role="main"] h1',
        '[role="main"] h2',
        '[role="main"] strong',
        '[aria-current="page"]',
        '[data-testid="mwthreadlist-item-open"]',
      ];
      for (const selector of selectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          const text = (el as HTMLElement).innerText || el.textContent || '';
          const firstLine = text.split('\n').map(line => line.trim()).find(Boolean) || text;
          const candidate = cleanFacebookNameCandidate(firstLine, { allowSingleName: selector.includes('aria-current') || selector.includes('mwthreadlist') });
          if (candidate) return candidate;
        }
      }
      return null;
    }

    function extractLikelyPersonName(rawText: string): string | null {
      const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
      if (!raw) return null;
      const labels = raw.match(/\b(?:Name|Customer|From|Sender|Profile)\s*:?\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})\b/);
      if (labels) return labels[1].trim();
      const name = raw.match(/\b([A-Z][a-zA-Z'-]{1,24}\s+[A-Z][a-zA-Z'-]{1,24}(?:\s+[A-Z][a-zA-Z'-]{1,24})?)\b/);
      if (!name) return null;
      const candidate = name[1].trim();
      const lower = candidate.toLowerCase();
      const bad = ['facebook marketplace', 'send message', 'view profile', 'add friend', 'people you', 'sponsored post', 'brevmont onboarding'];
      if (bad.some(x => lower.includes(x))) return null;
      return candidate;
    }

    function isLikelyUiName(name: unknown): boolean {
      const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
      if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return true;
      if (cleaned.includes('@')) return true;
      return /^(?:ad options|advertising|sponsored|promoted|2023 grade|grade|follow|message|connect|open to|profile|activity|about|experience|education|people also viewed|linkedin|notifications|jobs|home|my network|premium)$/i.test(cleaned)
        || /\b(?:ad|options|grade|sponsored|promoted|follow|connect)\b/i.test(cleaned);
    }

    function extractLinkedInProfileSignal(): { customerName?: string | null; headline?: string | null; company?: string | null; rawPrefix?: string; confidence?: number } {
      if (!isLinkedIn) return {};
      const pickText = (selector: string): string | null => {
        const el = document.querySelector(selector) as HTMLElement | null;
        const text = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
        return text || null;
      };
      const nameSelectors = [
        'main h1.text-heading-xlarge',
        '.pv-text-details__left-panel h1',
        '.ph5 h1',
        'h1.text-heading-xlarge',
        '.msg-overlay-bubble-header__title',
        '.msg-s-message-group__name',
        '.msg-thread__link-to-profile',
        '.msg-entity-lockup__entity-title',
        '[data-anonymize="person-name"]',
      ];
      const rawName = nameSelectors.map(pickText).find((candidate) => candidate && !isLikelyUiName(candidate)) || null;
      const headline = pickText('.text-body-medium.break-words')
        || pickText('.pv-text-details__left-panel .text-body-medium')
        || pickText('.msg-entity-lockup__entity-info')
        || null;
      const company = pickText('.pv-text-details__right-panel a[href*="/company/"]')
        || pickText('a[data-field="experience_company_logo"]')
        || null;
      const confidence = rawName ? 0.9 : 0.25;
      const rawPrefix = [
        rawName ? `Profile name: ${rawName}` : '',
        headline ? `Headline: ${headline}` : '',
        company ? `Company: ${company}` : '',
        rawName && isLikelyUiName(rawName) ? 'Lead scan confidence: low - LinkedIn UI text ignored' : '',
      ].filter(Boolean).join('\n');
      return { customerName: rawName, headline, company, rawPrefix, confidence };
    }

    function extractPartialLeadSignals(rawText: string): { customerName?: string | null; email?: string | null; phone?: string | null; vehicle?: string | null } {
      const raw = String(rawText || '');
      const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
      const phone = raw.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0] || null;
      const spacedVehicle = raw.match(/\b((?:19|20)\d{2}\s+[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\b/);
      const gluedVehicle = raw.match(/\b((?:19|20)\d{2})([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z0-9-]*){0,3})\b/);
      const yearLastVehicle = raw.match(new RegExp(`\\b((?:${AUTO_MAKES_RE})\\s+[A-Z][A-Za-z0-9-]*(?:\\s+[A-Z][A-Za-z0-9-]*){0,3})\\s+((?:19|20)\\d{2})\\b`, 'i'));
      const vehicle = spacedVehicle?.[1]?.trim()
        || (gluedVehicle ? `${gluedVehicle[1]} ${gluedVehicle[2]}`.trim() : null)
        || (yearLastVehicle ? `${yearLastVehicle[2]} ${yearLastVehicle[1]}`.trim() : null);
      const emailName = email ? email.split('@')[0].replace(/[._+-]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
      return { customerName: emailName || extractFacebookConversationName() || extractLikelyPersonName(raw), email, phone, vehicle };
    }

    function extractGmailLeadSignal(rawText: string): { customerName?: string | null; email?: string | null; rawPrefix?: string } {
      if (!isGmail) return {};
      const candidates = Array.from(document.querySelectorAll('.gD[email], .go[email], .g2[email], .gD[data-hovercard-id], [email], [data-hovercard-id], a[href^="mailto:"]')) as HTMLElement[];
      let senderEl = candidates.find(el => {
        const email = el.getAttribute('email')
          || el.getAttribute('data-hovercard-id')
          || (el as HTMLAnchorElement).href?.replace(/^mailto:/, '').split('?')[0]
          || '';
        return /@/.test(email);
      }) || null;

      if (!senderEl) {
        senderEl = document.querySelector('[aria-label*="@"][role="button"], [aria-label*="@"] [role="button"], [title*="@"]') as HTMLElement | null;
      }

      const attrEmail = senderEl?.getAttribute('email')
        || senderEl?.getAttribute('data-hovercard-id')
        || (senderEl as HTMLAnchorElement | null)?.href?.replace(/^mailto:/, '').split('?')[0]
        || senderEl?.getAttribute('aria-label')?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
        || senderEl?.getAttribute('title')?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
        || rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
        || null;

      const attrName = senderEl?.getAttribute('name')
        || senderEl?.getAttribute('data-name')
        || senderEl?.getAttribute('aria-label')?.replace(attrEmail || '', '')
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
      const subject = (
        (document.querySelector('h2.hP, .hP, [data-legacy-thread-id] h2') as HTMLElement | null)?.innerText ||
        (document.querySelector('[role="main"] h2') as HTMLElement | null)?.innerText ||
        ''
      ).replace(/\s+/g, ' ').trim();
      const rawPrefix = [
        subject ? `Subject: ${subject}` : '',
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
      target.focus();
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const proto = Object.getPrototypeOf(target);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
                     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        desc?.set?.call(target, text);
      } else if ((target as any).isContentEditable) {
        // Step 1: clear ANY existing content via the editor's own pipeline.
        // Lexical/Draft/Slate intercept beforeinput — using execCommand('selectAll')
        // + execCommand('delete') dispatches the correct events so the editor's
        // internal model is wiped, not just the DOM. Selecting via Range +
        // selection.deleteContents() left Lexical's state stale, causing the
        // next insertText to APPEND instead of replace — that was the
        // "double inject" symptom on Messenger.
        let cleared = false;
        try {
          document.execCommand('selectAll');
          cleared = document.execCommand('delete');
        } catch {
          cleared = false;
        }
        if (!cleared || (target.textContent || '').length > 0) {
          // Belt + suspenders: if execCommand path didn't wipe it (older
          // editors, sandboxed iframes), clear the DOM directly.
          while (target.firstChild) target.removeChild(target.firstChild);
        }

        // Step 2: insert the new text. Selection is now collapsed inside the
        // empty editor — execCommand('insertText') will go through the
        // editor's beforeinput handler and add a single copy.
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, text);
        } catch {
          inserted = false;
        }

        // Fallback ONLY when insertText genuinely failed AND the field is
        // still empty. Caught 2026-06-27: Messenger's Lexical editor would
        // double-render the message because execCommand('insertText') succeeded
        // (text was in Lexical's model AND in the DOM) but the validation
        // `rendered.includes(expectedStart)` sometimes missed due to Lexical's
        // wrapper nodes, triggering `target.textContent = text` — which
        // Lexical's MutationObserver interpreted as a SECOND insert, leaving
        // its internal model with the text twice. The rendered Messenger
        // compose field then showed the doubled copy with no separator
        // ("details?Hey Adrian..."). Trusting `inserted` and checking
        // emptiness eliminates the double-write.
        const renderedFull = (target.textContent || '');
        if (!inserted && renderedFull.trim().length === 0) {
          target.textContent = text;
        }

        // Final dedup safety net: if the field somehow ended up with the same
        // text >= twice (an upstream MutationObserver loop, a stale draft, or
        // another extension racing), strip back to a single copy. Checks for
        // a 40-char chunk of the text appearing more than once.
        const dedupChunk = text.trim().slice(0, Math.max(40, Math.min(80, text.trim().length)));
        if (dedupChunk && renderedFull.length > 0) {
          const occurrences = renderedFull.split(dedupChunk).length - 1;
          if (occurrences >= 2) {
            // Wipe the field via the editor pipeline again and re-insert exactly once.
            try {
              document.execCommand('selectAll');
              document.execCommand('delete');
              document.execCommand('insertText', false, text);
            } catch {
              while (target.firstChild) target.removeChild(target.firstChild);
              target.textContent = text;
            }
          }
        }

        const selection = window.getSelection();
        const endRange = document.createRange();
        endRange.selectNodeContents(target);
        endRange.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(endRange);
      } else {
        target.textContent = text;
      }
      // Lexical (Messenger), Draft.js, Slate listen for input/beforeinput
      // and treat (inputType:'insertText', data:<full text>) as "the user
      // just typed this entire string" — they then insert the text into
      // their model. execCommand('insertText') already routed through the
      // editor pipeline once above, so dispatching a SECOND synthetic
      // InputEvent with data:text causes Lexical to insert it AGAIN,
      // producing the observed "...today?Hey Adrian..." doubled output.
      // For contenteditable, fire a plain input event (no inputType, no
      // data) so React/MutationObserver change-detection still fires
      // without re-inserting. For input/textarea, the original synthetic
      // event is safe and required for React controlled inputs.
      if ((target as any).isContentEditable) {
        target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      } else {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function stripEmailMarkdownPreserveLines(value: unknown): string {
      return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function escapeHtml(value: string): string {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function restoreSignatureLineBreaks(text: string): string {
      const lines = text.split('\n');
      const lastIndex = lines.length - 1;
      const lastLine = lines[lastIndex] || '';
      const dealerTail = '(?:Subaru|Ford|Chevrolet|Chevy|Toyota|Honda|Hyundai|Kia|GMC|Jeep|Dodge|Ram|Nissan|Mazda|Cadillac|Buick|Lincoln|Lexus|Acura|BMW|Mercedes|Volkswagen|VW|Motors|Auto|Autos|Dealership|Group|Store)';
      const signatureMatch = lastLine.match(new RegExp(`\\b(Best regards,|Best,|Thanks,|Thank you,|Sincerely,|Regards,)\\s+([A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){0,2})\\s+((?:Sales|Internet|Business|BDC|Finance|Fleet|General|Product)[A-Za-z\\s/&-]{2,50}?)\\s+([A-Z][A-Za-z0-9&'. -]+${dealerTail}\\b.*)$`, 'i'));
      if (signatureMatch) {
        const before = lastLine.slice(0, signatureMatch.index ?? 0).trimEnd();
        lines[lastIndex] = [
          before,
          before ? '' : null,
          signatureMatch[1].trim(),
          signatureMatch[2].trim(),
          signatureMatch[3].trim(),
          signatureMatch[4].trim(),
        ].filter((part): part is string => part !== null).join('\n');
        return lines.join('\n');
      }

      const pipeMatch = lastLine.match(/([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2})\s+\|\s+([^|]{3,60})\s+\|\s+([^|]{3,120})$/);
      if (pipeMatch) {
        const before = lastLine.slice(0, pipeMatch.index ?? 0).trimEnd();
        lines[lastIndex] = [
          before,
          before ? '' : null,
          pipeMatch[1].trim(),
          pipeMatch[2].trim(),
          pipeMatch[3].trim(),
        ].filter((part): part is string => part !== null).join('\n');
        return lines.join('\n');
      }

      return text;
    }

    function normalizeEmailBodyForInjection(body: string): string {
      const normalized = stripEmailMarkdownPreserveLines(body)
        .replace(/^\s*(?:body|email body|message|email)\s*[:\-]\s*/i, '')
        .trim();
      return restoreSignatureLineBreaks(normalized);
    }

    function emailTextToHtml(text: string): string {
      return text
        .split('\n')
        .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
        .join('');
    }

    function safeInjectEmailBody(target: HTMLElement, text: string) {
      const normalized = normalizeEmailBodyForInjection(text);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        safeInjectText(target, normalized);
        return;
      }

      if ((target as any).isContentEditable) {
        target.focus();
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const html = emailTextToHtml(normalized);
        let inserted = false;
        try {
          inserted = document.execCommand('insertHTML', false, html);
        } catch {
          inserted = false;
        }
        const expectedStart = normalized.trim().slice(0, 24);
        const rendered = (target.textContent || '').trim();
        if (!inserted || (expectedStart && !rendered.includes(expectedStart))) {
          target.innerHTML = html;
        }

        const endRange = document.createRange();
        endRange.selectNodeContents(target);
        endRange.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(endRange);
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertHTML', data: normalized }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
      }

      safeInjectText(target, normalized);
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
    const brevmontState = ((window as any).__BREVMONT_CONTENT_SCRIPT_STATE = (window as any).__BREVMONT_CONTENT_SCRIPT_STATE || {}) as {
      initialized?: boolean;
      messageListenerRegistered?: boolean;
      lastInjectedText?: string;
      lastInjectedTime?: number;
    };
    if (brevmontState.initialized) {
      dlog('[Brevmont] Content script already initialized; skipping duplicate registration');
      return;
    }
    brevmontState.initialized = true;

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
          const compatible = trimCrmNoteForCompatibility(note, PLATFORM);

          safeInjectText(notesField, compatible.text);
          notesField.dispatchEvent(new Event('input', { bubbles: true }));
          notesField.dispatchEvent(new Event('change', { bubbles: true }));
          notesField.dispatchEvent(new Event('blur', { bubbles: true }));

          const toast = document.createElement('div');
          toast.textContent = compatible.trimmed
            ? `Note trimmed to ${compatible.limit} characters for CRM compatibility`
            : 'Call note generated.';
          Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background: compatible.trimmed ? '#C4841D' : '#0F1419', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'12px', fontWeight:'500', zIndex:'99999' });
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
      let composeActive = hasActiveComposeSurface(PLATFORM);
      if (composeActive) clearLeadContextCache('compose surface active on load');
      const composeObserver = new MutationObserver(() => {
        const nextComposeActive = hasActiveComposeSurface(PLATFORM);
        if (nextComposeActive && !composeActive) {
          clearLeadContextCache('compose surface opened');
        }
        composeActive = nextComposeActive;
      });
      addObserver(composeObserver, document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['role', 'aria-label', 'style', 'class'],
      });

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
      const compatible = trimCrmNoteForCompatibility(noteText, PLATFORM);
      await browser.storage.local.set({ brevmont_paste_note: compatible.text, brevmont_paste_note_time: Date.now() });
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
        safeInjectText(textarea, compatible.text);
        textarea.style.border = '2px solid #16a34a';
        setTimeout(() => { textarea!.style.border = ''; }, 2000);
        browser.storage.local.remove(['brevmont_paste_note', 'brevmont_paste_note_time']);
        if (compatible.trimmed) {
          showHostToast(`Note trimmed to ${compatible.limit} characters for CRM compatibility`, 'warn');
        }
        return true;
      } else {
        try {
          browser.runtime.sendMessage({
            type: 'SAVE_PENDING_NOTE',
            payload: { customer_name: leadData?.customerName || safeExtractContactName() || '', note_text: compatible.text, contact_id: null }
          });
        } catch(e) {}
        if (compatible.trimmed) {
          showHostToast(`Note trimmed to ${compatible.limit} characters for CRM compatibility`, 'warn');
        }
        return false;
      }
    }

    // ===== INJECT CONTENT (Side Panel → host page DOM) =====
    function isVisibleElement(el: Element | null): el is HTMLElement {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    }

    function firstVisible(selectors: string[], root: ParentNode = document): HTMLElement | null {
      for (const selector of selectors) {
        for (const el of Array.from(root.querySelectorAll(selector))) {
          if (isVisibleElement(el)) return el;
        }
      }
      return null;
    }

    function findEmailComposeRoot(seed?: HTMLElement | null): ParentNode {
      if (!seed) return document;
      return seed.closest('.M9, [role="dialog"], form, .aoI, .nH') || document;
    }

    function findGmailComposeBody(): HTMLElement | null {
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable) {
        const label = (active.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('message') || active.matches('.Am.Al.editable, div[role="textbox"]')) return active;
      }

      return firstVisible([
        'div[aria-label="Message Body"][contenteditable="true"]',
        'div[aria-label="Message Body"]',
        'div[role="textbox"][g_editable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '.Am.Al.editable[contenteditable="true"]',
        '.Am.Al.editable',
        '[g_editable="true"][contenteditable="true"]',
      ]);
    }

    function findGmailSubjectInput(bodyEl?: HTMLElement | null): HTMLInputElement | null {
      const selectors = [
        'input[name="subjectbox"]',
        'input[aria-label="Subject"]',
        'input[placeholder="Subject"]',
      ];
      const roots = bodyEl ? [findEmailComposeRoot(bodyEl), document] : [document];
      for (const root of roots) {
        const subject = firstVisible(selectors, root);
        if (subject instanceof HTMLInputElement) return subject;
      }
      return null;
    }

    function isLikelySubjectField(el: HTMLElement): boolean {
      const text = [
        el.getAttribute('name'),
        el.id,
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes('subject');
    }

    function splitGeneratedEmail(content: string, explicitSubject?: string): { subject: string; body: string } {
      let subject = stripEmailMarkdownPreserveLines(explicitSubject || '')
        .replace(/^\s*(?:subject(?:\s+line)?|subj)\s*[:\-]\s*/i, '')
        .trim();
      let body = stripEmailMarkdownPreserveLines(content || '')
        .replace(/^\s*(?:email|email reply|reply|generated email)\s*:?\s*(?:\n+|$)/i, '');

      const subjectMatch = body.match(/^\s*(?:subject(?:\s+line)?|subj)\s*[:\-]\s*([^\n]+)\n+/i);
      if (subjectMatch) {
        subject = subject || subjectMatch[1].trim();
        body = body.slice(subjectMatch[0].length);
      } else {
        const inlineSubjectMatch = body.match(/^\s*(?:subject(?:\s+line)?|subj)\s*[:\-]\s*(.+?)\s+(?:body|email body|message)\s*[:\-]\s*([\s\S]+)$/i);
        if (inlineSubjectMatch) {
          subject = subject || inlineSubjectMatch[1].trim();
          body = inlineSubjectMatch[2];
        }
      }

      return { subject, body: normalizeEmailBodyForInjection(body) };
    }

    function injectGmailEmail(content: string, subject?: string): boolean {
      const bodyEl = findGmailComposeBody();
      if (!bodyEl) return false;
      const parsed = splitGeneratedEmail(content, subject);
      if (isDuplicateInject(`email:${parsed.subject}\n${parsed.body}`)) return true;
      if (parsed.subject) {
        const subjectEl = findGmailSubjectInput(bodyEl);
        if (subjectEl) safeInjectText(subjectEl, parsed.subject);
      }
      safeInjectEmailBody(bodyEl, parsed.body || content);
      return true;
    }

    function findGenericEmailSubjectInput(bodyEl?: HTMLElement | null): HTMLElement | null {
      const selectors = [
        'input[name*="subject" i]',
        'input[id*="subject" i]',
        'input[aria-label*="subject" i]',
        'input[placeholder*="subject" i]',
        'textarea[name*="subject" i]',
        'textarea[id*="subject" i]',
        'textarea[aria-label*="subject" i]',
        'textarea[placeholder*="subject" i]',
      ];
      const roots = bodyEl ? [findEmailComposeRoot(bodyEl), document] : [document];
      for (const root of roots) {
        const subject = firstVisible(selectors, root);
        if (subject) return subject;
      }
      return null;
    }

    function findGenericEmailBody(): HTMLElement | null {
      const active = document.activeElement as HTMLElement | null;
      if (active && isVisibleElement(active) && !isLikelySubjectField(active) && ((active as any).isContentEditable || active instanceof HTMLTextAreaElement)) {
        return active;
      }

      const body = firstVisible([
        'textarea[name*="body" i]',
        'textarea[id*="body" i]',
        'textarea[aria-label*="body" i]',
        'textarea[placeholder*="body" i]',
        'textarea[name*="message" i]',
        'textarea[id*="message" i]',
        'textarea[aria-label*="message" i]',
        'textarea[placeholder*="message" i]',
        '[contenteditable="true"][aria-label*="message" i]',
        '[contenteditable="true"][aria-label*="body" i]',
        '[contenteditable="true"][role="textbox"]',
      ]);
      return body && !isLikelySubjectField(body) ? body : null;
    }

    function isKnownEmailInjectionPage(): boolean {
      const host = window.location.hostname.toLowerCase();
      return isGmail
        || isVinSolutions
        || /(^|\.)mail\./.test(host)
        || /(^|\.)outlook\./.test(host)
        || /(^|\.)office\.com$/.test(host)
        || /(^|\.)yahoo\./.test(host)
        || /(^|\.)icloud\./.test(host)
        || /(^|\.)zoho\./.test(host)
        || /(^|\.)proton(?:mail)?\./.test(host);
    }

    function injectGenericEmail(content: string, subject?: string): boolean {
      const bodyEl = findGenericEmailBody();
      if (!bodyEl) return false;
      const parsed = splitGeneratedEmail(content, subject);
      if (isDuplicateInject(`email:${parsed.subject}\n${parsed.body}`)) return true;
      if (parsed.subject) {
        const subjectEl = findGenericEmailSubjectInput(bodyEl);
        if (subjectEl) safeInjectText(subjectEl, parsed.subject);
      }
      safeInjectEmailBody(bodyEl, parsed.body || content);
      return true;
    }

    function findLinkedInMessageBox(): HTMLElement | null {
      const selectors = [
        '.msg-form__contenteditable[contenteditable="true"]',
        '.msg-form__msg-content-container [contenteditable="true"]',
        '.msg-overlay-conversation-bubble [contenteditable="true"]',
        '.msg-form [role="textbox"][contenteditable="true"]',
        'div[aria-label*="Write a message" i][contenteditable="true"]',
        'div[aria-label*="message" i][contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
      ];
      for (const selector of selectors) {
        const matches = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
        const visible = matches.find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 10;
        });
        if (visible) return visible;
      }
      return null;
    }

    function isDuplicateInject(content: string): boolean {
      const text = String(content || '');
      if (!text.trim()) return false;
      const now = Date.now();
      if (text === brevmontState.lastInjectedText && now - Number(brevmontState.lastInjectedTime || 0) < 3000) {
        return true;
      }
      brevmontState.lastInjectedText = text;
      brevmontState.lastInjectedTime = now;
      return false;
    }

    async function injectContent(parsed: any): Promise<boolean> {
      const { action, subject } = parsed;
      const content = String(parsed.content || '');
      if ((action === 'write_email' || PLATFORM === 'gmail') && isGmail) return injectGmailEmail(content, subject);
      if (action === 'write_email' && isKnownEmailInjectionPage()) return injectGenericEmail(content, subject);
      if ((action === 'write_facebook_message' || PLATFORM === 'facebook') && isFacebook) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { if (isDuplicateInject(content)) return true; safeInjectText(box, content); return true; } }
      if ((action === 'write_linkedin_message' || PLATFORM === 'linkedin') && isLinkedIn) { const box = findLinkedInMessageBox(); if (box) { if (isDuplicateInject(content)) return true; safeInjectText(box, content); return true; } }
      if (PLATFORM === 'whatsapp') { const box = document.querySelector('div[contenteditable="true"][data-tab="10"]') as HTMLElement ?? document.querySelector('footer div[contenteditable="true"]') as HTMLElement; if (box) { if (isDuplicateInject(content)) return true; safeInjectText(box, content); return true; } }
      if (isInstagram) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement ?? document.querySelector('textarea[placeholder]') as HTMLElement; if (box) { if (isDuplicateInject(content)) return true; safeInjectText(box, content); return true; } }
      if (action === 'log_crm_note' && isVinSolutions) return await pasteIntoCRM(content || '');
      return false;
    }

    // ===== MESSAGE LISTENER (Side Panel + Background bridge) =====
    const handleBrevmontMessage = (msg: any, _sender: any, sendResponse: any): boolean | void => {
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
        (async () => {
          try {
            const detected = await detectCustomerFromPage();
            // Final safety net — some upstream path may still return a
            // channel or UI label (Messenger, Marketplace, Buyer, SOLD).
            // The AI turns any non-null customer_name into "Hi <name>",
            // which is worse than "Hi there." Reject known bad names
            // here so nothing downstream has to remember to check.
            const pickCleanName = (...candidates: (string | null | undefined)[]): string | null => {
              for (const c of candidates) {
                const trimmed = (c || '').trim();
                if (!trimmed) continue;
                if (isChannelOrUiName(trimmed)) continue;
                return trimmed;
              }
              return null;
            };
            const customerName = pickCleanName(
              leadData?.customerName,
              detected?.name,
              extractFacebookConversationName(),
              safeExtractContactName(),
            );
            const vehicle = leadData?.vehicle || detected?.vehicle || null;
            const fingerprint = buildContextFingerprint({
              name: customerName,
              vehicle,
              method: detected ? `auto_${detected.method}` : 'content_context',
            });
            sendResponse({
              customerName,
              customer_name: customerName,
              name: customerName,
              vehicle,
              phone: leadData?.phone || detected?.phone || null,
              email: leadData?.email || detected?.email || null,
              source: leadData?.source || detected?.source || null,
              vehicleMake: leadData?.vehicleMake || null,
              vehicleModel: leadData?.vehicleModel || null,
              vehicleOfInterest: leadData?.vehicleOfInterest || vehicle || null,
              platform: PLATFORM,
              detectionConfidence: detected?.confidence ?? (customerName ? 0.55 : 0),
              detectionMethod: detected ? `auto_${detected.method}` : null,
              leadCreatedAt: scrapeLeadCreatedAt(),
              ...fingerprint,
            });
          } catch {
            sendResponse({ platform: PLATFORM });
          }
        })();
        return true;
      }

      if (msg.type === 'GET_SIDEBAR_STATE') {
        sendResponse({ platform: PLATFORM, sidebarOpen: false, hasLead: !!(leadData?.customerName) });
        return false;
      }

      if (msg.type === 'SCAN_LEAD') {
        (async () => {
        try {
          const detected = await detectCustomerFromPage();
          let rawText = '';
          if (isFacebook) {
            const main = document.querySelector('[role="main"]') as HTMLElement | null;
            const facebookName = extractFacebookConversationName() || safeExtractContactName();
            const authorText = Array.from(document.querySelectorAll('[role="main"] h1, [role="main"] h2, [role="main"] strong, [aria-label*="Profile picture of"], [aria-label*="Conversation with"]'))
              .map((el) => {
                const label = el.getAttribute('aria-label') || '';
                return [label, (el as HTMLElement).innerText || el.textContent || ''].filter(Boolean).join(' ');
              })
              .filter(Boolean)
              .slice(0, 20)
              .join('\n');
            rawText = [
              facebookName ? `Profile name: ${facebookName}` : '',
              authorText,
              main?.innerText || document.body?.innerText || '',
            ].filter(Boolean).join('\n');
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
          const partialSignal = extractPartialLeadSignals(rawText);
          const scanned = isVinSolutions ? scanText(rawText) : {};
          const linkedinSignal = extractLinkedInProfileSignal();
          if (linkedinSignal.rawPrefix) {
            rawText = `${linkedinSignal.rawPrefix}\n\n${rawText}`.slice(0, 5000);
          }
          const rawName = scanned.customerName || leadData?.customerName || gmailSignal.customerName || linkedinSignal.customerName || detected?.name || extractFacebookConversationName() || safeExtractContactName() || partialSignal.customerName;
          const name = isLikelyUiName(rawName) ? null : rawName;
          const phone = scanned.phone || leadData?.phone || detected?.phone || partialSignal.phone || null;
          const email = scanned.email || leadData?.email || detected?.email || gmailSignal.email || partialSignal.email || null;
          const vehicle = scanned.vehicle || leadData?.vehicle || leadData?.vehicleOfInterest || detected?.vehicle || partialSignal.vehicle || null;
          const detectionMethod = linkedinSignal.customerName ? 'linkedin_profile_selector' : (detected ? `auto_${detected.method}` : 'scan_lead');
          const fingerprint = buildContextFingerprint({ name, vehicle, rawText, method: detectionMethod });
          sendResponse({
            name: name || null,
            customerName: name || null,
            customer_name: name || null,
            phone,
            email,
            vehicle,
            vehicle_interest: vehicle,
            source: scanned.source || leadData?.source || detected?.source || null,
            status: scanned.status || leadData?.status || null,
            lastContact: scanned.lastContact || leadData?.lastContact || null,
            platform: PLATFORM,
            raw_text: rawText,
            source_raw_text: rawText,
            detectionConfidence: linkedinSignal.confidence ?? detected?.confidence ?? (name ? 0.55 : 0),
            detectionMethod,
            ...fingerprint,
          });
        } catch {
          sendResponse({ name: null, customerName: null, platform: PLATFORM });
        }
        })();
        return true;
      }

      if (msg.type === 'INJECT_CONTENT' || msg.type === 'INJECT_EMAIL' || msg.type === 'INJECT_CRM_NOTE') {
        (async () => {
          try {
            const payload = msg.payload || msg;
            const outputType = payload.outputType || (msg.type === 'INJECT_EMAIL' ? 'email' : msg.type === 'INJECT_CRM_NOTE' ? 'crm' : 'text');
            const content = payload.content || payload.body || payload.note || '';
            const mapped: any = {
              action: outputType === 'email' ? 'write_email' : outputType === 'crm' ? 'log_crm_note' : 'write_message',
              content,
              subject: payload.subject,
            };
            const ok = await injectContent(mapped);
            if (!ok) {
              navigator.clipboard.writeText(content).catch(() => {});
            }
            sendResponse({ ok });
          } catch (e: any) {
            sendResponse({ ok: false, error: e.message });
          }
        })();
        return true;
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
            text = main ? main.innerText.slice(0, 5000) : document.body.innerText.slice(0, 5000);
          } else if (isLinkedIn) {
            const thread = document.querySelector('.msg-s-message-list-content, [class*="msg-thread"], [class*="message-list"], .msg-conversations-container__thread-view, [class*="scaffold-layout__detail"]');
            text = thread ? (thread as HTMLElement).innerText.slice(0, 5000) : document.body.innerText.slice(0, 5000);
          } else if (isGmail) {
            const msgEl = document.querySelector('.h7, [role="list"], .a3s');
            text = msgEl ? (msgEl as HTMLElement).innerText.slice(0, 5000) : document.body.innerText.slice(0, 5000);
          } else if (isInstagram) {
            const thread = document.querySelector('[role="main"]');
            text = thread ? (thread as HTMLElement).innerText.slice(0, 5000) : document.body.innerText.slice(0, 5000);
          } else {
            text = document.body.innerText.slice(0, 5000);
          }
          sendResponse({ text: text.replace(/\s+/g, ' ').trim() });
        } catch {
          sendResponse({ text: '' });
        }
        return false;
      }
    };

    if (!brevmontState.messageListenerRegistered) {
      browser.runtime.onMessage.addListener(handleBrevmontMessage);
      brevmontState.messageListenerRegistered = true;
    }

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
