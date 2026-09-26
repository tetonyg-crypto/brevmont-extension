/**
 * Outlook web adapter — outlook.live.com / outlook.office.com thread views.
 *
 * Uses conservative Microsoft web selectors plus ARIA fallbacks. If Outlook
 * changes the reading pane or compose body, detect() still succeeds but
 * scrape/inject return sparse data so the sidepanel falls back to manual input.
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
import { extractVehicleHint, findGenericComposer, stableKeyFromPath } from './shared';

const CAPS: AdapterCapabilities = {
  supports_inject_text: false,
  supports_inject_email: true,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'email',
  default_output: 'email',
};

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return u.includes('outlook.live.com') || u.includes('outlook.office.com') || u.includes('outlook.office365.com');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

function readSubject(): string {
  const selectors = [
    '[role="heading"][aria-level="1"]',
    '[data-testid="message-subject"]',
    '[data-testid="conversationSubject"]',
    'div[aria-label^="Subject"]',
    'h1',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    const text = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length < 240) return text;
  }
  return '';
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const BODY_SELECTOR = '[data-testid*="messageBody" i], [aria-label*="Message body" i], [role="document"], article';
const SENDER_SELECTOR = '[data-testid*="sender" i], [aria-label^="From" i], .ms-Persona-primaryText, [title*="@"]';
// Reply/compose editors match the body selector too ("Message body" is the
// editor's aria-label); a draft must never be read as a received message.
const COMPOSE_SELECTOR = '[contenteditable="true"], [contenteditable=""], [role="textbox"], [data-app-section*="compose" i], [aria-label*="compose" i], [data-testid*="compose" i]';

function readingPane(): HTMLElement | null {
  return (document.querySelector('[data-app-section="ConversationReadingPane"]') as HTMLElement | null)
    || (document.querySelector('[role="main"]') as HTMLElement | null);
}

function inCompose(el: Element): boolean {
  return !!el.closest(COMPOSE_SELECTOR);
}

/** Visible text of a message body with any embedded editor removed. */
function bodyText(root: HTMLElement): string {
  if (!root.querySelector(COMPOSE_SELECTOR)) {
    return (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
  }
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(COMPOSE_SELECTOR).forEach((el) => el.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

type OutlookSender = { name: string; email?: string; source: string };

function cleanSenderName(value: string): string {
  const name = value
    .replace(/^From\s*:?\s*/i, '')
    .replace(/<[^>]+>/g, '')
    .replace(new RegExp(EMAIL_RE.source, 'ig'), '')
    .replace(/[<>()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length > 1 && name.length < 80 ? name : '';
}

function parseSender(el: HTMLElement, source: string): OutlookSender | null {
  const attr = (el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const email = attr.match(EMAIL_RE)?.[0] || text.match(EMAIL_RE)?.[0] || undefined;
  const name = cleanSenderName(attr) || cleanSenderName(text);
  if (!email && !name) return null;
  return { name, email, source };
}

/** Signed-in account identity from the Microsoft account control. Empty when not found. */
function selfIdentity(): { emails: Set<string>; names: Set<string> } {
  const emails = new Set<string>();
  const names = new Set<string>();
  const nodes = Array.from(document.querySelectorAll(
    '#mectrl_currentAccount_primary, #mectrl_currentAccount_secondary, #mectrl_main_trigger, #O365_MainLink_Me, [data-testid*="mectrl_currentAccount" i]',
  )) as HTMLElement[];
  for (const el of nodes) {
    for (const value of [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]) {
      const v = String(value || '').replace(/\s+/g, ' ').trim();
      if (!v) continue;
      const email = v.match(EMAIL_RE)?.[0];
      if (email) emails.add(email.toLowerCase());
      const name = v.replace(/^account manager for\s+/i, '').replace(new RegExp(EMAIL_RE.source, 'ig'), '').replace(/[<>()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name && name.length > 1 && name.length < 80 && !/^(?:account manager|sign out|my account)$/i.test(name)) names.add(name.toLowerCase());
    }
  }
  return { emails, names };
}

function isSelf(sender: OutlookSender, self: { emails: Set<string>; names: Set<string> }): boolean {
  if (sender.email && self.emails.has(sender.email.toLowerCase())) return true;
  return !!sender.name && self.names.has(sender.name.toLowerCase());
}

/** Sender of one message body: the nearest ancestor (inside the pane) that owns exactly this body and a sender element. */
function senderForBody(root: HTMLElement, pane: HTMLElement, bodies: HTMLElement[]): OutlookSender | null {
  let node: HTMLElement | null = root.parentElement;
  while (node && pane.contains(node)) {
    const senderEl = Array.from(node.querySelectorAll(SENDER_SELECTOR))
      .find((el) => !root.contains(el) && !inCompose(el)) as HTMLElement | undefined;
    if (senderEl) {
      // Ancestor that holds more than one message body cannot attribute this one.
      if (bodies.some((other) => other !== root && node!.contains(other))) return null;
      return parseSender(senderEl, 'outlook:message_sender');
    }
    if (node === pane) break;
    node = node.parentElement;
  }
  return null;
}

type OutlookMessage = { text: string; direction: 'inbound' | 'outbound' | 'unknown'; sender: OutlookSender | null };

function readMessages(): OutlookMessage[] {
  const pane = readingPane();
  if (!pane) return [];
  const matched = (Array.from(pane.querySelectorAll(BODY_SELECTOR)) as HTMLElement[]).filter((el) => !inCompose(el));
  // [role=document] sits inside article: keep the innermost body only.
  const bodies = matched.filter((el) => !matched.some((other) => other !== el && el.contains(other)));
  const self = selfIdentity();
  const hasSelf = self.emails.size > 0 || self.names.size > 0;
  const out: OutlookMessage[] = [];
  for (const root of bodies.slice(-24)) {
    const text = bodyText(root);
    if (!text || text.length < 5) continue;
    const sender = senderForBody(root, pane, bodies);
    // Inbound only when the sender is known AND is not the signed-in account.
    const direction = !sender || !hasSelf ? 'unknown' : isSelf(sender, self) ? 'outbound' : 'inbound';
    out.push({ text: text.slice(0, 800), direction, sender });
  }
  return out;
}

function scrapeThread(): ThreadContext {
  let read: OutlookMessage[] = [];
  const subject = readSubject();
  try {
    read = readMessages();
  } catch {
    /* noop */
  }
  const messages: ThreadContext['messages'] = read.map(({ text, direction }) => ({ text, direction }));
  const pane = readingPane();
  const rawText = (pane?.innerText || document.body?.innerText || '').slice(0, 5000);
  const last = read.slice().reverse().find((m) => m.direction === 'inbound')?.text || '';
  return {
    conversation_key: stableKeyFromPath('outlook'),
    raw_text: [subject, rawText].filter(Boolean).join('\n').slice(0, 5000),
    messages,
    last_inbound_text: last,
    header_text: subject,
    url: window.location.href,
  };
}

function extractCustomer(): CustomerCandidate {
  const pane = readingPane();
  if (!pane) return { name: null };
  let read: OutlookMessage[] = [];
  try {
    read = readMessages();
  } catch {
    /* noop */
  }
  const inboundSender = read.slice().reverse().find((m) => m.direction === 'inbound' && m.sender)?.sender || null;
  const self = selfIdentity();
  const candidates: OutlookSender[] = inboundSender ? [inboundSender] : [];
  if (!inboundSender) {
    for (const el of Array.from(pane.querySelectorAll(SENDER_SELECTOR)) as HTMLElement[]) {
      if (inCompose(el)) continue;
      const sender = parseSender(el, 'outlook:reading_pane_sender');
      if (sender && !isSelf(sender, self)) { candidates.push(sender); break; }
    }
  }
  const sender = candidates[0];
  if (!sender) return { name: null };
  if (sender.name) {
    return { name: sender.name, email: sender.email, raw_source: sender.source, confidence: 0.78 };
  }
  if (sender.email) {
    return { name: sender.email.split('@')[0], email: sender.email, raw_source: `${sender.source}:email_local`, confidence: 0.62 };
  }
  return { name: null };
}

function extractContext(): DealContext {
  const subject = readSubject();
  const body = ((document.querySelector('[data-app-section="ConversationReadingPane"], [role="main"]') as HTMLElement | null)?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(`${subject}\n${body}`);
  return {
    subject_line: subject || null,
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, _kind: InjectKind): Promise<InjectResult> {
  const body =
    (document.querySelector('[aria-label*="Message body" i][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
    findGenericComposer('email');
  if (!body) return { ok: false, reason: 'no_outlook_compose_body' };
  return {
    ok: true,
    method: 'outlook_compose_body',
    composer_selector: '[aria-label*="Message body"][contenteditable="true"]',
  };
}

export const outlookAdapter: PlatformAdapter = {
  id: 'outlook',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
