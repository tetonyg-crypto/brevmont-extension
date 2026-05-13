/**
 * VinSolutions + shared lead scanning — extracted from legacy content.ts
 * Shared helpers used by the injected sidebar content script (and tests).
 */

const MAKES =
  'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';
const STOP_WORDS =
  'Created|Attempted|Contacted|Looking|Wants|Also|Stock|Source|Status|miles|General|Customer|Interested|Trade|lineup|options|inventory|Calculated|Equity|Payoff|hover|details|Bad|Sold|Active|Lost';
const POISON_BEFORE = /(?:Equity|Payoff|Trade-in|trade\s+value|Credit)\b[\s\S]{0,50}$/i;
const POISON_AFTER = /^[\s\S]{0,20}(?:Calculated|Payoff|payoff|appraised)/i;

function isPoisoned(text: string, mi: number, ml: number): boolean {
  return POISON_BEFORE.test(text.slice(Math.max(0, mi - 60), mi)) || POISON_AFTER.test(text.slice(mi + ml, mi + ml + 40));
}

export function extractVehicle(text: string): string {
  let v = '';
  const vi = text.match(
    new RegExp('Vehicle Info[\\s\\n]+(20\\d{2}\\s+(?:' + MAKES + ')\\s+[^\\n(]+?)\\s*(?:\\(|\\n|$)', 'i')
  );
  if (vi) v = vi[1].trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!v) {
    const am = text.match(
      new RegExp('Active\\t[\\s\\S]{0,80}?(20\\d{2}\\s+(?:' + MAKES + ')[^\\t\\n]*)', 'i')
    );
    if (am) {
      let x = am[1].trim().replace(/\s+/g, ' ');
      x = x.replace(new RegExp('\\s+(?:' + STOP_WORDS + ')\\b.*', 'i'), '');
      v = x.slice(0, 50);
    }
  }
  if (!v) {
    for (const m of text.matchAll(
      new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')(?:\\s+(?!(?:' + STOP_WORDS + ')\\b)[A-Za-z0-9./-]+){0,5})', 'gi')
    )) {
      if (!isPoisoned(text, m.index!, m[0].length)) {
        v = m[1].trim().replace(/\s+/g, ' ').slice(0, 50);
        break;
      }
    }
  }
  if (!v) {
    for (const m of text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + '))', 'gi'))) {
      if (!isPoisoned(text, m.index!, m[0].length)) {
        v = m[1].trim().slice(0, 40);
        break;
      }
    }
  }
  if (!v) {
    const sv = text.match(/(?:Stock\s*#|Vehicle)\s*:?\s*[\s\S]{0,30}?(20\d{2}\s+\w+\s+[\w-]+)/i);
    if (sv) v = sv[1].trim().slice(0, 50);
  }
  if (!v) {
    const sh = text.match(
      /(?:Sold|Active|Lost)\s+[\s\S]{0,60}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i
    );
    if (sh) v = sh[1].trim().replace(/\s+/g, ' ').slice(0, 50);
  }
  if (!v) {
    const voi = text.match(/Vehicle(?:\(s\))?\s*of\s*Interest\s*[\s\S]{0,60}?(20\d{2}\s+\w+(?:\s+\w+){0,4})/i);
    if (voi) v = voi[1].trim().replace(/\s+/g, ' ').slice(0, 50);
  }
  if (!v) {
    const si = text.match(
      /Sale\s*Info\s*[\s\S]{0,200}?(20\d{2}\s+(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Za-z0-9 /-]+)/i
    );
    if (si) v = si[1].trim().replace(/\s+/g, ' ').slice(0, 50);
  }
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

export function extractByLabel(labelText: string): string | null {
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
    const cells = [...row.querySelectorAll('th,td')].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
    const idx = cells.findIndex((c) => /^vehicle$/i.test(c));
    if (idx >= 0 && cells[idx + 1]) {
      const val = cells[idx + 1];
      if (/20\d{2}/.test(val)) return val.slice(0, 60);
    }
  }
  return null;
}

export function deepTableVehicleSearch(): string | null {
  function searchDoc(doc: Document): string | null {
    const fromTable = extractVehicleFromTable(doc);
    if (fromTable) return fromTable;
    const allTables = doc.querySelectorAll('table');
    for (const table of allTables) {
      const headers = [...table.querySelectorAll('th')];
      const vehIdx = headers.findIndex((h) => /^vehicle$/i.test((h.textContent || '').trim()));
      if (vehIdx < 0) continue;
      const dataRows = [...table.querySelectorAll('tbody tr, tr')].filter((r) => r.querySelector('td'));
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
      } catch {
        /* cross-origin */
      }
    }
    return null;
  }
  return searchDoc(document);
}

export function gatherAllText(): string {
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
      } catch {
        /* cross-origin */
      }
    }
  }
  readIframes(document);
  return text;
}

export function getDashboardScopedText(): string {
  const full = gatherAllText();
  const idx = full.search(/Customer Dashboard/i);
  if (idx === -1) return '';
  return full.slice(idx);
}

export type LeadScanResult = {
  customerName: string;
  phone: string;
  email: string;
  vehicle: string | null;
  source: string;
  status: string;
  lastContact: string;
};

export function scanVinText(text: string, isVinSolutions: boolean): LeadScanResult {
  let name = '';
  const labelName = extractByLabel('Customer Dashboard');
  if (labelName) name = labelName;
  if (!name) {
    const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
    if (dm) name = dm[1].trim();
  }
  if (!name) {
    const im = text.match(
      /([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/
    );
    if (im) name = im[1].trim();
  }
  let phone = '';
  const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');
  let email = '';
  const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  if (em) email = em[0];
  if (!email) {
    const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    for (const link of mailtoLinks) {
      const href = (link as HTMLAnchorElement).href;
      if (href) {
        email = href.replace('mailto:', '').split('?')[0];
        break;
      }
    }
  }
  if (!email && isVinSolutions) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
        if (!doc) continue;
        const links = doc.querySelectorAll('a[href^="mailto:"]');
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          if (href) {
            email = href.replace('mailto:', '').split('?')[0];
            break;
          }
        }
        if (email) break;
        const bodyEmail = (doc.body?.innerText || '').match(/[\w.-]+@[\w.-]+\.\w{2,}/);
        if (bodyEmail) {
          email = bodyEmail[0];
          break;
        }
      } catch {
        /* noop */
      }
    }
  }
  let vehicle: string | null = deepTableVehicleSearch() || extractByLabel('Vehicle') || null;
  if (!vehicle) vehicle = extractVehicle(text) || null;
  let source = '';
  const sm = text.match(/Source:\s*(.+)/i);
  if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
  let status = '';
  const stm = text.match(/Status:\s*(.+)/i);
  if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
  let lastContact = '';
  const cm =
    text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i);
  if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
  return { customerName: name, phone, email, vehicle, source, status, lastContact };
}

export function safeInjectText(target: HTMLElement, text: string) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const proto = Object.getPrototypeOf(target);
    const desc =
      Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    desc?.set?.call(target, text);
  } else if ((target as HTMLElement).isContentEditable) {
    target.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  } else {
    (target as HTMLElement).textContent = text;
  }
  target.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
  );
  target.dispatchEvent(new Event('change', { bubbles: true }));
  target.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** Non-Vin contact name (Gmail, Facebook/Messenger, LinkedIn, Instagram, …). */
export function extractContactName(platform: string): string | null {
  if (platform === 'gmail') {
    // Priority order matters: when a compose dialog is OPEN, that's the
    // rep's active intent (writing a new email or reply). The underlying
    // thread behind it is just background — its .gD sender is NOT the
    // customer being written to. v1.14.3 had compose-mode after open-
    // thread paths and returned the wrong "Brevmont"-style sender on
    // every compose-over-thread case. v1.14.4 inverts the priority.
    const composeRoot =
      document.querySelector('div[role="dialog"]') ||
      document.querySelector('[role="region"][aria-label*="compose" i]') ||
      null;
    if (composeRoot) {
      // Resolved chips carry email + display name on the same element.
      const hover = composeRoot.querySelector('[data-hovercard-id]');
      if (hover) {
        const candidateName =
          hover.getAttribute('name') ||
          (hover as HTMLElement).textContent?.trim() ||
          null;
        if (candidateName && candidateName.length > 1 && candidateName.length < 60 && !candidateName.includes('@')) {
          return candidateName;
        }
        const email = hover.getAttribute('data-hovercard-id') || '';
        const local = email.split('@')[0];
        if (local && local.length > 1 && local.length < 60) return local;
      }
      const toInput = composeRoot.querySelector('input[name="to"]') as HTMLInputElement | null;
      const raw = toInput?.value?.trim() || '';
      if (raw) {
        const local = raw.split('@')[0];
        if (local && local.length > 1 && local.length < 60) return local;
      }
      // Compose is open but To is empty — return null instead of falling
      // through to an unrelated thread sender. Better signal: "no contact
      // captured" than "wrong contact captured." Documented in
      // DEVIATIONS.md D-2026-05-06-6 (compose-with-empty-To).
      return null;
    }
    // No compose dialog open — read the currently-viewed thread.
    const senderEl = document.querySelector('.gD') as HTMLElement | null;
    if (senderEl) {
      const name = senderEl.getAttribute('name') || senderEl.textContent?.trim() || null;
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
  if (platform === 'facebook') {
    const headerSpan =
      document.querySelector('div[role="main"] h1') ||
      document.querySelector('h1') ||
      document.querySelector('[aria-label*="Profile"] h1') ||
      document.querySelector('[data-testid="mwthreadlist-item-open"] span') ||
      document.querySelector('div[role="main"] h2 span') ||
      document.querySelector('div[role="banner"] a[role="link"] span') ||
      document.querySelector('[role="main"] strong a[role="link"] span') ||
      document.querySelector('[role="main"] a[role="link"][href*="/profile.php"] span') ||
      document.querySelector('[role="main"] a[role="link"][href^="/"] span');
    if (headerSpan) {
      const name = (headerSpan as HTMLElement).textContent?.trim();
      if (name && name.length > 1 && name.length < 50 && !name.includes('@')) return name;
    }
    const labelled = Array.from(document.querySelectorAll('[aria-label]')).find(el => {
      const label = el.getAttribute('aria-label') || '';
      return /^(?:Message|Conversation with|Profile picture of|Open profile for)\s+/i.test(label);
    });
    if (labelled) {
      const label = labelled.getAttribute('aria-label') || '';
      const cleaned = label
        .replace(/^(?:Message|Conversation with|Profile picture of|Open profile for)\s+/i, '')
        .replace(/\s+(?:profile|conversation)$/i, '')
        .trim();
      if (cleaned && cleaned.length > 1 && cleaned.length < 50 && !cleaned.includes('@')) return cleaned;
    }
    const convoHeader = document.querySelector('[aria-label*="Conversation with"]');
    if (convoHeader) {
      const label = convoHeader.getAttribute('aria-label') || '';
      const match = label.match(/Conversation with (.+)/i);
      if (match && match[1].trim().length > 1) return match[1].trim();
    }
    if (window.location.hostname.includes('messenger.com')) {
      const title = document.title.replace(/ - .*$/, '').replace(/\(\d+\)\s*/, '').trim();
      if (title && title.length > 1 && title.length < 50 && title !== 'Messenger') return title;
    }
    return null;
  }
  if (platform === 'linkedin') {
    const nameEl =
      document.querySelector('.msg-overlay-bubble-header__title') ||
      document.querySelector('.msg-s-message-group__name') ||
      document.querySelector('.msg-thread__link-to-profile') ||
      document.querySelector('.msg-entity-lockup__entity-title') ||
      document.querySelector('[class*="msg-overlay-conversation-bubble"] h2');
    if (nameEl) {
      const name = (nameEl as HTMLElement).textContent?.trim();
      if (name && name.length > 1 && name.length < 60) return name;
    }
    return null;
  }
  if (platform === 'instagram') {
    const igHeader = document.querySelector('header h2') || document.querySelector('[role="heading"]');
    if (igHeader) {
      const name = (igHeader as HTMLElement).textContent?.trim();
      if (name && name.length > 1 && name.length < 50) return name;
    }
    return null;
  }
  return null;
}

/** Legacy import path — same implementation as `extractContactName`. */
export const extractContactNameLite = extractContactName;
