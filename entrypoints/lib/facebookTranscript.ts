import { cleanMessengerMessageText, isMessengerSystemCardText } from './messengerSystemText';

export type FacebookTranscriptRole = 'customer' | 'rep' | 'unknown';
export type FacebookTranscriptDirection = 'inbound' | 'outbound' | 'unknown';

export interface FacebookTranscriptMessage {
  text: string;
  direction: FacebookTranscriptDirection;
  role: FacebookTranscriptRole;
  source_selector: string;
  extraction_method: string;
  confidence: number;
  is_system: boolean;
  hash: string;
  ts?: number;
}

export interface FacebookTranscript {
  messages: FacebookTranscriptMessage[];
  raw_text: string;
  last_inbound_text: string;
  last_inbound_hash: string;
  message_count: number;
  scanned_at: number;
}

const MESSAGE_CONTAINER_SELECTOR = [
  '[role="row"]',
  '[data-scope="messages_table"]',
  '[data-testid*="message" i]',
  '[data-testid*="messenger" i]',
].join(', ');

function weakHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function facebookTranscriptHash(value: unknown): string {
  return weakHash(String(value || '').replace(/\s+/g, ' ').trim());
}

function attrText(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  for (let depth = 0; current && depth < 3; depth += 1) {
    for (const attr of ['aria-label', 'data-testid', 'data-scope', 'data-message-direction', 'data-testid-direction', 'class']) {
      const value = current.getAttribute(attr);
      if (value) parts.push(value);
    }
    current = current.parentElement;
  }
  el.querySelectorAll('[aria-label], [data-testid], [data-message-direction], [data-testid-direction]').forEach((child) => {
    for (const attr of ['aria-label', 'data-testid', 'data-message-direction', 'data-testid-direction']) {
      const value = child.getAttribute(attr);
      if (value) parts.push(value);
    }
  });
  return parts.join(' ');
}

function isLikelySystemElement(el: Element, text: string): boolean {
  if (!text || text.length < 2) return true;
  if (isMessengerSystemCardText(text)) return true;
  const aria = attrText(el);
  if (/\b(?:rate|rating|timestamp|separator|divider|marketplace listing|listing card|see details|more options)\b/i.test(aria)) return true;
  if (/^(?:sun|mon|tue|wed|thu|fri|sat)\b/i.test(text) && /\b\d{1,2}:\d{2}\b/.test(text)) return true;
  if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;
  const buttons = Array.from(el.querySelectorAll('button, [role="button"]'))
    .map((button) => (button as HTMLElement).innerText || button.getAttribute('aria-label') || '')
    .join(' ');
  if (/\b(?:rate|see details|more options)\b/i.test(buttons) && text.length < 360) return true;
  return false;
}

function hasBubbleShape(el: Element): boolean {
  const textBoxes = el.querySelectorAll('[dir="auto"], [data-testid*="message" i], [role="gridcell"], span, div');
  if (textBoxes.length === 0) return false;
  const text = cleanMessengerMessageText((el as HTMLElement).innerText || '');
  if (!text || text.length < 2) return false;
  if (isLikelySystemElement(el, text)) return false;
  return true;
}

function visualDirection(el: Element, main: Element): { direction: FacebookTranscriptDirection; method: string; confidence: number } {
  try {
    const mainRect = (main as HTMLElement).getBoundingClientRect();
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (mainRect.width > 0 && rect.width > 0) {
      const center = rect.left + rect.width / 2;
      const right = center > mainRect.left + mainRect.width * 0.58;
      const left = center < mainRect.left + mainRect.width * 0.42;
      if (right) return { direction: 'outbound', method: 'geometry_right', confidence: 0.72 };
      if (left) return { direction: 'inbound', method: 'geometry_left', confidence: 0.72 };
    }
  } catch {}
  return { direction: 'unknown', method: 'unknown_geometry', confidence: 0 };
}

function structuralDirection(el: Element, main: Element): { direction: FacebookTranscriptDirection; method: string; confidence: number } {
  const attrs = attrText(el);
  if (/\b(?:outgoing|outbound|message_out|sent by you|you sent|you replied)\b/i.test(attrs)) {
    return { direction: 'outbound', method: 'structural_outbound_attr', confidence: 0.96 };
  }
  if (/\b(?:incoming|inbound|message_in|received)\b/i.test(attrs)) {
    return { direction: 'inbound', method: 'structural_inbound_attr', confidence: 0.96 };
  }
  if (/\bprofile picture of\b/i.test(attrs) && !/\b(?:you|your profile)\b/i.test(attrs)) {
    return { direction: 'inbound', method: 'profile_image_association', confidence: 0.84 };
  }
  const style = (el as HTMLElement).style;
  if (style?.marginLeft === 'auto' || style?.justifyContent === 'flex-end' || style?.textAlign === 'right') {
    return { direction: 'outbound', method: 'inline_alignment_outbound', confidence: 0.8 };
  }
  if (style?.marginRight === 'auto' || style?.justifyContent === 'flex-start' || style?.textAlign === 'left') {
    return { direction: 'inbound', method: 'inline_alignment_inbound', confidence: 0.8 };
  }
  return visualDirection(el, main);
}

function sourceSelector(el: Element): string {
  if (el.getAttribute('role')) return `[role="${el.getAttribute('role')}"]`;
  if (el.getAttribute('data-scope')) return `[data-scope="${el.getAttribute('data-scope')}"]`;
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  return el.tagName.toLowerCase();
}

export function extractFacebookTranscript(root: ParentNode = document): FacebookTranscript {
  const scanned_at = Date.now();
  const main = root.querySelector?.('[role="main"]') || root.querySelector?.('main') || document.body;
  const messages: FacebookTranscriptMessage[] = [];
  if (!main) {
    return { messages, raw_text: '', last_inbound_text: '', last_inbound_hash: facebookTranscriptHash(''), message_count: 0, scanned_at };
  }

  const seen = new Set<string>();
  const candidates = Array.from((main as Element).querySelectorAll(MESSAGE_CONTAINER_SELECTOR)).slice(-80);
  for (const candidate of candidates) {
    const text = cleanMessengerMessageText((candidate as HTMLElement).innerText || '');
    if (!text || isLikelySystemElement(candidate, text) || !hasBubbleShape(candidate)) continue;
    const normalized = text.replace(/\s+/g, ' ').trim();
    const key = `${normalized}:${sourceSelector(candidate)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const directionResult = structuralDirection(candidate, main as Element);
    const direction = directionResult.direction;
    const role: FacebookTranscriptRole = direction === 'inbound' ? 'customer' : direction === 'outbound' ? 'rep' : 'unknown';
    messages.push({
      text: normalized.slice(0, 700),
      direction,
      role,
      source_selector: sourceSelector(candidate),
      extraction_method: directionResult.method,
      confidence: directionResult.confidence,
      is_system: false,
      hash: facebookTranscriptHash(normalized),
    });
  }

  const safeMessages = messages.filter((message) => message.direction !== 'unknown');
  const lastInbound = safeMessages.slice().reverse().find((message) => message.role === 'customer')?.text || '';
  const raw_text = safeMessages
    .slice(-25)
    .map((message) => `[${message.role}] ${message.text}`)
    .join('\n')
    .slice(0, 5000);

  return {
    messages: safeMessages.slice(-30),
    raw_text,
    last_inbound_text: lastInbound.slice(0, 2000),
    last_inbound_hash: facebookTranscriptHash(lastInbound),
    message_count: safeMessages.length,
    scanned_at,
  };
}
