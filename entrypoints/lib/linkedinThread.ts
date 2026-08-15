/**
 * LinkedIn messaging scrape — always the open thread pane, never the inbox rail.
 *
 * Inbox rows (including Sponsored Messaging ads) reuse the same lockup /
 * snippet classes as the open conversation. A document-wide querySelector
 * therefore latches onto Peter Lezama / "Sponsored Messaging Ad" while the
 * rep is in Glen Trafford or Chris Hogan.
 */

export function isLinkedInSponsoredText(value: unknown): boolean {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return (
    /\bsponsored(?:\s+messaging)?(?:\s+ad)?\b/i.test(text)
    || /\byou(?:'|’)re receiving this ad\b/i.test(text)
    || /\bintended audience\b/i.test(text)
    || /\bad options\b/i.test(text)
  );
}

export function isLinkedInMessagingSurface(url = ''): boolean {
  const href = String(url || (typeof window !== 'undefined' ? window.location.href : '')).toLowerCase();
  return /linkedin\.com\/messaging/i.test(href);
}

function isInsideInboxRail(el: Element | null): boolean {
  if (!el) return false;
  // Only the conversation LIST. Do not treat msg-overlay-list-bubble__content
  // as the rail: LinkedIn wraps the open overlay thread in that same shell.
  return Boolean(
    el.closest('.msg-conversations-container__conversations-list')
    || el.closest('ul.msg-conversations-container__conversations-list')
    || el.closest('[data-test-id="conversation-list"]'),
  );
}

export function findActiveLinkedInThreadRoot(doc: Document = document): HTMLElement | null {
  const overlay = doc.querySelector(
    '.msg-overlay-conversation-bubble:not(.msg-overlay-conversation-bubble--is-minimized) .msg-s-message-list-content',
  ) as HTMLElement | null;
  if (overlay && !isInsideInboxRail(overlay)) return overlay;

  const scoped = [
    '.scaffold-layout__detail .msg-s-message-list-content',
    '.msg-thread .msg-s-message-list-content',
    '.msg-conversations-container__thread-view .msg-s-message-list-content',
    '.msg-overlay-conversation-bubble--default-active .msg-s-message-list-content',
  ];
  for (const sel of scoped) {
    const el = doc.querySelector(sel) as HTMLElement | null;
    if (el && !isInsideInboxRail(el)) return el;
  }

  const anyList = Array.from(doc.querySelectorAll('.msg-s-message-list-content'))
    .find((el) => !isInsideInboxRail(el)) as HTMLElement | undefined;
  if (anyList) return anyList;

  const threadView =
    (doc.querySelector('.scaffold-layout__detail .msg-thread') as HTMLElement | null)
    || (doc.querySelector('.msg-conversations-container__thread-view') as HTMLElement | null)
    || (doc.querySelector('.msg-thread') as HTMLElement | null);
  if (threadView && !isInsideInboxRail(threadView)) return threadView;
  return null;
}

function cleanName(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function readLinkedInThreadHeader(doc: Document = document): string {
  const root = findActiveLinkedInThreadRoot(doc);
  const scopes: Array<Element | null> = [
    doc.querySelector('.scaffold-layout__detail .msg-title-bar'),
    doc.querySelector('.msg-thread .msg-title-bar'),
    doc.querySelector('.msg-overlay-conversation-bubble:not(.msg-overlay-conversation-bubble--is-minimized) .msg-overlay-bubble-header'),
    root?.closest('.scaffold-layout__detail') || null,
    root?.closest('.msg-thread') || null,
    root,
  ];
  const selectors = [
    '.msg-entity-lockup__entity-title',
    '.msg-overlay-bubble-header__title',
    '.msg-thread__link-to-profile',
    'h2',
    'h1',
  ];
  for (const scope of scopes) {
    if (!scope || isInsideInboxRail(scope)) continue;
    for (const sel of selectors) {
      const el = scope.querySelector(sel) as HTMLElement | null;
      const text = cleanName(el?.innerText || el?.textContent);
      if (!text || text.length < 2 || text.length > 120) continue;
      if (isLinkedInSponsoredText(text)) continue;
      if (/^(?:messaging|linkedin|sponsored)$/i.test(text)) continue;
      return text.slice(0, 200);
    }
  }
  return '';
}

export function extractLinkedInThreadCustomer(doc: Document = document): { name: string | null; raw_source: string; confidence: number } {
  const href = typeof window !== 'undefined' ? window.location.href : '';
  if (isLinkedInMessagingSurface(href) || findActiveLinkedInThreadRoot(doc)) {
    const header = readLinkedInThreadHeader(doc);
    const name = header.split(/\s*[·•|]\s*/)[0]?.trim() || '';
    if (name && name.length >= 2 && name.length <= 80 && !isLinkedInSponsoredText(name) && !/^(?:messaging|linkedin)$/i.test(name)) {
      return { name, raw_source: 'linkedin_open_thread_header', confidence: 0.92 };
    }
    return { name: null, raw_source: 'linkedin_open_thread_missing', confidence: 0 };
  }

  const profileSelectors = [
    'main h1.text-heading-xlarge',
    '.pv-text-details__left-panel h1',
    '.ph5 h1',
    'h1.text-heading-xlarge',
  ];
  for (const sel of profileSelectors) {
    const el = doc.querySelector(sel) as HTMLElement | null;
    const raw = cleanName(el?.innerText || el?.textContent);
    if (!raw || raw.length < 2 || raw.length > 80) continue;
    if (isLinkedInSponsoredText(raw) || /^(?:messaging|linkedin)$/i.test(raw)) continue;
    return { name: raw, raw_source: `linkedin_profile:${sel}`, confidence: 0.85 };
  }
  return { name: null, raw_source: 'linkedin_profile_missing', confidence: 0 };
}

function bubbleDirection(el: Element): 'inbound' | 'outbound' | 'unknown' {
  const cls = `${el.className || ''} ${el.parentElement?.className || ''}`;
  if (/\bmsg-s-event-listitem--self\b|\bfrom-self\b/i.test(cls)) return 'outbound';
  if (/\bmsg-s-event-listitem--other\b|\bfrom-them\b/i.test(cls)) return 'inbound';
  const label = el.getAttribute('aria-label') || '';
  if (/you sent|sent by you/i.test(label)) return 'outbound';
  return 'unknown';
}

export function scrapeLinkedInOpenThread(doc: Document = document): {
  raw_text: string;
  header_text: string;
  messages: Array<{ text: string; direction: 'inbound' | 'outbound' | 'unknown' }>;
  last_inbound_text: string;
} {
  const header_text = readLinkedInThreadHeader(doc);
  const root = findActiveLinkedInThreadRoot(doc);
  const messages: Array<{ text: string; direction: 'inbound' | 'outbound' | 'unknown' }> = [];
  if (root) {
    const bubbles = Array.from(
      root.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event, .msg-s-event-listitem__message-bubble'),
    ).slice(-40);
    for (const b of bubbles) {
      const t = cleanName((b as HTMLElement).innerText || (b as HTMLElement).textContent);
      if (!t || t.length < 3) continue;
      if (isLinkedInSponsoredText(t)) continue;
      messages.push({ text: t.slice(0, 600), direction: bubbleDirection(b) });
    }
  }
  const lastInbound =
    [...messages].reverse().find((m) => m.direction === 'inbound')?.text
    || [...messages].reverse().find((m) => m.direction !== 'outbound' && !isLinkedInSponsoredText(m.text))?.text
    || '';
  const raw_text = [header_text, ...(root ? [cleanName(root.innerText).slice(0, 4500)] : [])]
    .filter(Boolean)
    .join('\n')
    .slice(0, 5000);
  return {
    raw_text,
    header_text,
    messages,
    last_inbound_text: lastInbound.slice(0, 2000),
  };
}
