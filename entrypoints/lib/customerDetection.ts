import { cleanCustomerNameCandidate } from './leadContextScan';

export interface DetectedCustomer {
  name: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  vehicle?: string;
  source: string;
  confidence: number;
  method: 'page_title' | 'visible_text' | 'conversation_context' | 'form_fields' | 'merged';
}

const MAKES =
  'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';

const BAD_NAMES = new Set([
  'facebook',
  'messenger',
  'marketplace',
  'chats',
  'search messenger',
  'brevmont',
  'brevmont labs',
  'brevmont labs llc',
  'archive',
  'archived',
  'save lead',
  'scan this page',
  'new message',
  'view profile',
  'no longer available',
]);

function normalizeSeparators(value: unknown): string {
  return String(value || '')
    .replace(/\u00c2\u00b7/g, '\u00b7')
    .replace(/\u00e2\u20ac\u00a2/g, '\u2022');
}

function cleanName(value: unknown, allowSingle = false): string | null {
  const raw = cleanCustomerNameCandidate(normalizeSeparators(value)
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|.-]\s*(?:Messenger|Facebook|Gmail|LinkedIn).*$/i, '')
    .replace(/\s*(?:\u00b7|\u2022)\s*20\d{2}\b.*$/i, '')
    .replace(/\s*[·•]\s*20\d{2}\b.*$/i, '')
    .replace(/\s*-\s*(?:Messages|Inbox|Conversation).*$/i, ''))
    .trim();
  if (!raw || raw.length < 2 || raw.length > 70 || raw.includes('@')) return null;
  if (BAD_NAMES.has(raw.toLowerCase())) return null;
  if (/^(?:you|me|buyer|seller|customer|profile|conversation)$/i.test(raw)) return null;
  const parts = raw.split(/\s+/);
  if (!allowSingle && parts.length < 2) return null;
  if (!parts.every((part) => /^[A-Za-z][A-Za-z'.-]*$/.test(part))) return null;
  return raw;
}

function splitName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined };
}

function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : undefined;
}

function extractEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
}

function extractVehicle(text: string): string | undefined {
  const yearFirst = text.match(new RegExp(`\\b(20\\d{2})\\s+(${MAKES})\\s+([A-Za-z0-9][A-Za-z0-9 /-]{1,50})`, 'i'));
  if (yearFirst) return `${yearFirst[1]} ${yearFirst[2]} ${yearFirst[3]}`.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim().slice(0, 80);
  const makeFirst = text.match(new RegExp(`\\b(${MAKES})\\s+([A-Za-z][A-Za-z0-9 /-]{1,38})\\s+(20\\d{2})\\b`, 'i'));
  if (makeFirst) return `${makeFirst[3]} ${makeFirst[1]} ${makeFirst[2]}`.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim().slice(0, 80);
  return undefined;
}

function sourceFromHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes('facebook') || host.includes('messenger')) return 'facebook';
  if (host.includes('mail.google')) return 'gmail';
  if (host.includes('linkedin')) return 'linkedin';
  if (host.includes('instagram')) return 'instagram';
  if (host.includes('vinsolutions') || host.includes('coxautoinc')) return 'vinsolutions';
  if (host.includes('whatsapp')) return 'whatsapp';
  return 'unknown';
}

function result(name: string, partial: Partial<DetectedCustomer>): DetectedCustomer {
  return {
    name,
    ...splitName(name),
    source: partial.source || sourceFromHost(window.location.hostname),
    confidence: partial.confidence ?? 0.5,
    method: partial.method || 'visible_text',
    phone: partial.phone,
    email: partial.email,
    vehicle: partial.vehicle,
  };
}

export function parsePageTitle(title: string): DetectedCustomer | null {
  const vehicle = extractVehicle(title);
  const normalizedTitle = normalizeSeparators(title);
  const normalizedMarketplace = normalizedTitle.match(/^(.+?)\s*(?:\u00b7|\u2022)\s*(20\d{2}\s+.+)$/i);
  if (normalizedMarketplace) {
    const name = cleanName(normalizedMarketplace[1], true);
    if (name) return result(name, { vehicle: vehicle || normalizedMarketplace[2], confidence: 0.84, method: 'page_title' });
  }
  const marketplace = title.match(/^(.+?)\s*[·•]\s*(20\d{2}\s+.+)$/i);
  if (marketplace) {
    const name = cleanName(marketplace[1], true);
    if (name) return result(name, { vehicle: vehicle || marketplace[2], confidence: 0.84, method: 'page_title' });
  }
  const cleaned = cleanName(title, true);
  if (!cleaned) return null;
  return result(cleaned, { vehicle, confidence: cleaned.split(/\s+/).length >= 2 ? 0.76 : 0.58, method: 'page_title' });
}

function textFrom(el: Element | null): string {
  return ((el as HTMLElement | null)?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
}

export function detectConversationContext(): DetectedCustomer | null {
  const source = sourceFromHost(window.location.hostname);
  const main = document.querySelector('[role="main"]') || document.body;
  const headerCandidates = [
    document.querySelector('[role="main"] h1'),
    document.querySelector('[role="main"] h2'),
    document.querySelector('header h1'),
    document.querySelector('header h2'),
    document.querySelector('[data-testid="mwthreadlist-item-open"] strong'),
    document.querySelector('[aria-label*="Conversation with"]'),
  ];

  for (const el of headerCandidates) {
    if (!el) continue;
    const aria = el.getAttribute('aria-label') || '';
    const name = cleanName(aria.replace(/^Conversation with\s+/i, '').replace(/^Profile picture of\s+/i, ''), source === 'facebook')
      || cleanName(textFrom(el), source === 'facebook');
    if (name) {
      const context = textFrom(main).slice(0, 4000);
      return result(name, {
        source,
        vehicle: extractVehicle(`${document.title}\n${context}`),
        phone: extractPhone(context),
        email: extractEmail(context),
        confidence: name.split(/\s+/).length >= 2 ? 0.9 : 0.72,
        method: 'conversation_context',
      });
    }
  }

  const body = textFrom(main).slice(0, 4000);
  const createdGroup = body.match(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2})\s+created this group\b/);
  if (createdGroup) {
    const name = cleanName(createdGroup[1], true);
    if (name) return result(name, { source, vehicle: extractVehicle(body), phone: extractPhone(body), email: extractEmail(body), confidence: 0.86, method: 'conversation_context' });
  }

  const activeList = document.querySelector('[aria-current="page"], [data-testid="mwthreadlist-item-open"], [role="row"][aria-selected="true"]');
  const activeText = textFrom(activeList);
  const listName = cleanName(activeText.split(/\n|You:|Draft:|sent|·/i)[0], source === 'facebook');
  if (listName) return result(listName, { source, vehicle: extractVehicle(activeText || document.title), confidence: 0.74, method: 'conversation_context' });

  return null;
}

export function scanVisibleText(): DetectedCustomer | null {
  const source = sourceFromHost(window.location.hostname);
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 12000);
  const phone = extractPhone(text);
  const email = extractEmail(text);
  const vehicle = extractVehicle(text);

  const profileName = text.match(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,2})\s+(?:created this group|started this chat|sent a photo|sent a message)\b/i);
  const nearPhone = phone
    ? text.slice(Math.max(0, text.indexOf(phone) - 120), Math.min(text.length, text.indexOf(phone) + 120))
    : '';
  const phoneName = nearPhone.match(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,2})\b/);
  const name = cleanName(profileName?.[1] || phoneName?.[1], false);
  if (!name) return null;
  return result(name, {
    source,
    phone,
    email,
    vehicle,
    confidence: phone || email || vehicle ? 0.72 : 0.55,
    method: 'visible_text',
  });
}

export function scanFormFields(): DetectedCustomer | null {
  const fields = Array.from(document.querySelectorAll('input, textarea, select')) as HTMLInputElement[];
  const values: Record<string, string> = {};
  for (const field of fields) {
    const label =
      field.getAttribute('aria-label') ||
      field.getAttribute('name') ||
      field.getAttribute('placeholder') ||
      field.id ||
      '';
    const value = String(field.value || '').trim();
    if (!value) continue;
    if (/customer|contact|name/i.test(label)) values.name = value;
    if (/phone|mobile|cell/i.test(label)) values.phone = value;
    if (/email/i.test(label)) values.email = value;
    if (/vehicle|model|car/i.test(label)) values.vehicle = value;
  }
  const name = cleanName(values.name, false);
  if (!name) return null;
  return result(name, {
    phone: extractPhone(values.phone || ''),
    email: extractEmail(values.email || ''),
    vehicle: values.vehicle || undefined,
    confidence: 0.82,
    method: 'form_fields',
  });
}

export function mergeSignals(signals: Array<DetectedCustomer | null>): DetectedCustomer | null {
  const valid = signals.filter(Boolean) as DetectedCustomer[];
  if (!valid.length) return null;
  valid.sort((a, b) => b.confidence - a.confidence);
  const best = { ...valid[0] };
  for (const signal of valid.slice(1)) {
    if (signal.name.toLowerCase() === best.name.toLowerCase()) {
      best.confidence = Math.min(0.99, best.confidence + 0.16);
      best.phone = best.phone || signal.phone;
      best.email = best.email || signal.email;
      best.vehicle = best.vehicle || signal.vehicle;
      best.method = 'merged';
    }
  }
  return best;
}

export function gmailSubjectText(): string {
  const el = document.querySelector('h2.hP, .hP, [role="main"] h2') as HTMLElement | null;
  return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
}

export function nameMatchesGmailSubject(name: string | null | undefined): boolean {
  const n = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const subject = gmailSubjectText().toLowerCase();
  if (!n || !subject) return false;
  return n === subject || subject.startsWith(`${n} `) || n.startsWith(subject);
}

function detectGmailSender(): DetectedCustomer | null {
  const senderEl = document.querySelector('.gD') as HTMLElement | null;
  let name = cleanName(senderEl?.getAttribute('name') || senderEl?.textContent, false);
  if (nameMatchesGmailSubject(name)) name = '';
  const email =
    normalizeEmailAttr(senderEl?.getAttribute('email')) ||
    extractEmail(document.body?.innerText || '');
  if (!name) return null;
  return result(name, {
    email,
    confidence: 0.93,
    method: 'conversation_context',
  });
}

function normalizeEmailAttr(value: unknown): string | undefined {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : undefined;
}

export async function detectCustomerFromPage(): Promise<DetectedCustomer | null> {
  const source = sourceFromHost(window.location.hostname);
  if (source === 'gmail') {
    return mergeSignals([
      detectGmailSender(),
      scanFormFields(),
    ]);
  }
  return mergeSignals([
    parsePageTitle(document.title || ''),
    detectConversationContext(),
    scanVisibleText(),
    scanFormFields(),
  ]);
}
