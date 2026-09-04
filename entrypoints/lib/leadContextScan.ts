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
const LINKEDIN_UI_NAME_RE =
  /^(?:ad options?|advertising|sponsored(?:\s+messaging(?:\s+ad)?)?|promoted|2023 grade|grade|follow|message|messages|messaging|connect|open to|profile|activity|about|experience|education|people also viewed|linkedin|notifications|jobs|home|feed|my network|network|premium|inmail)$/i;

// Any candidate that equals one of these (case-insensitive, trimmed) is a
// UI/channel label, not a person. Discovered 2026-07-02 on live demo: on
// messenger.com/marketplace/t/... the top div[role="main"] h1 is literally
// "Messenger" (the channel indicator) — extractContactName was returning
// that as customer_name, and the generated follow-up read "Hi Messenger,
// this is Yancy Garcia at Ridgeline Chevrolet…". Same class of bug for
// Marketplace, Buyer, Seller, Facebook, Chats, etc. Add every UI label
// we've seen — being loud here is fine because a genuine name never
// collides with these words.
const CHANNEL_OR_UI_NAMES = new Set([
  'messenger', 'facebook', 'marketplace', 'chats', 'chat',
  'gmail', 'inbox', 'mail', 'sent', 'drafts',
  'linkedin', 'instagram', 'whatsapp', 'twitter', 'x',
  'vinsolutions', 'cox', 'salesforce', 'hubspot',
  'buyer', 'seller', 'customer', 'contact', 'lead',
  'new message', 'new chat', 'no longer available', 'sold',
  'brevmont', 'brevmont labs', 'brevmont labs llc', 'save lead', 'scan this page',
  'profile', 'conversation', 'notifications', 'search',
  'you', 'me', 'other', 'group',
  // 2026-07-03 regression: Facebook Marketplace threads for accounts
  // without a friendly display name render the h1 as
  // "Conversation titled Cardog" and the sidebar Action strip renders
  // an aria-label of just "Actions". Both were slipping through as
  // customer_name and producing "Hi Actions" / "Hi Conversation
  // Titled Cardog" openings. Added below plus regex fallbacks.
  'actions', 'action',
  'options', 'menu', 'archive', 'archived',
  'reply', 'send', 'settings',
  'messaging', 'messages', 'message', 'feed', 'ad options', 'ad option',
  'sponsored', 'sponsored messaging', 'sponsored messaging ad', 'inmail',
  'jobs', 'my network', 'network', 'premium', 'people also viewed',
]);

export function isChannelOrUiName(value: unknown): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return true;
  if (CHANNEL_OR_UI_NAMES.has(raw)) return true;
  // Multi-word variants: "SOLD - 2015 Subaru Outback", "Facebook Marketplace",
  // "Marketplace Buyer" etc.
  if (/^(?:sold|active|available|listed|new)\b/i.test(raw)) return true;
  if (/^(?:facebook|messenger|marketplace|instagram)\s/i.test(raw)) return true;
  if (/^brevmont\b/i.test(raw)) return true;
  if (/\bbrevmont labs\b/i.test(raw)) return true;
  if (LINKEDIN_UI_NAME_RE.test(raw)) return true;
  if (/^sponsored\b/i.test(raw)) return true;
  if (/\b(?:ad options?|messaging ad)\b/i.test(raw)) return true;
  // Facebook Marketplace fallback headers for accounts without a friendly
  // display name. "Conversation titled X" is the raw h1; "Chat with X"
  // is a common aria-label variant; "X started this chat" appears in
  // the thread body as a system message.
  if (/^conversation\s+\w+\s+\S+/i.test(raw)) return true;
  if (/^conversation\s+titled\b/i.test(raw)) return true;
  if (/^conversation\s+\w+$/i.test(raw)) return true;
  if (/^chat\s+with\b/i.test(raw)) return true;
  if (/\bstarted\s+this\s+chat\b/i.test(raw)) return true;
  return false;
}

export function stripConversationWrapper(value: unknown): string {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return raw;
  const patterns = [
    /^conversation\s+\w+\s+(.+)$/i,
    /^chat\s+with\s+(.+)$/i,
    /^message\s+(.+)$/i,
    /^profile\s+picture\s+of\s+(.+)$/i,
    /^open\s+profile\s+for\s+(.+)$/i,
    /^started\s+this\s+chat\s+with\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const inner = match?.[1]?.trim();
    if (inner) return inner;
  }
  return raw;
}

export function cleanCustomerNameCandidate(value: unknown): string {
  const cleaned = stripConversationWrapper(value)
    .replace(/\(\d+\)\s*/g, '')
    .replace(/\s+\((?:he|she|they)\/(?:him|her|them)\)/ig, '')
    .replace(/\s+\|\s+(?:Messenger|Facebook|Gmail|LinkedIn).*$/i, '')
    .replace(/\s+-\s+(?:Messenger|Facebook|Gmail|LinkedIn).*$/i, '')
    .replace(/\s*[·•-]\s*(?:19|20)\d{2}\b.*$/i, '')
    .replace(/\b(?:created this group|sent a photo|sent an attachment|is waiting for your response)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || isChannelOrUiName(cleaned)) return '';
  return cleaned;
}

function isPoisoned(text: string, mi: number, ml: number): boolean {
  return POISON_BEFORE.test(text.slice(Math.max(0, mi - 60), mi)) || POISON_AFTER.test(text.slice(mi + ml, mi + ml + 40));
}

function cleanCandidateText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isLikelyUiName(value: unknown): boolean {
  const candidate = cleanCandidateText(value);
  if (!candidate || candidate.length < 2 || candidate.length > 80) return true;
  if (candidate.includes('@')) return true;
  if (isChannelOrUiName(candidate)) return true;
  return false;
}

export function deepVisibleText(root: ParentNode | null | undefined, max = 8000): string {
  if (!root) return '';
  const host = root as HTMLElement;
  const direct = String(host.innerText || '').replace(/\s+/g, ' ').trim();
  if (direct.length > 24) return direct.slice(0, max);
  const chunks: string[] = [];
  const visit = (node: Node) => {
    if (chunks.join('\n').length >= max) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) chunks.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') return;
    if (el.shadowRoot) visit(el.shadowRoot);
    for (const child of Array.from(el.childNodes)) visit(child);
  };
  visit(root as Node);
  return chunks.join('\n').slice(0, max);
}

function textFromSelector(selector: string): string | null {
  const el = document.querySelector(selector) as HTMLElement | null;
  const text = cleanCandidateText(el?.innerText || el?.textContent || '');
  return text || null;
}

export function isLinkedInFeedOrChromeSurface(href = window.location.href): boolean {
  return /linkedin\.com\/(?:feed|mynetwork|notifications|jobs)(?:\/|\?|$)/i.test(href);
}

export function isLinkedInMessagingSurface(href = window.location.href): boolean {
  return /linkedin\.com\/messaging/i.test(href)
    || Boolean(document.querySelector('.msg-entity-lockup__entity-title, .msg-thread__link-to-profile, .msg-form__contenteditable'));
}

export function isLinkedInSponsoredThread(text: string): boolean {
  return /sponsored messaging ad|you(?:'|’)re receiving this ad because/i.test(text);
}

function normalizePersonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function linkedInSelfNames(): Set<string> {
  const names = new Set<string>();
  const nodes = [
    ...Array.from(document.querySelectorAll('.global-nav__me, .global-nav__me-photo, button.global-nav__primary-link--me, .feed-identity-module__actor-meta, [data-control-name="identity_welcome_message"]')),
    ...Array.from(document.querySelectorAll('img.global-nav__me-photo, .global-nav__me img, a[href*="/in/"] img')),
  ] as HTMLElement[];
  for (const el of nodes) {
    if (!el.closest('header, .global-nav, .feed-identity-module')) continue;
    for (const value of [el.getAttribute('alt'), el.getAttribute('aria-label'), el.textContent]) {
      const name = cleanLinkedInPersonLabel(String(value || ''));
      if (name) names.add(normalizePersonKey(name.split(/\s+(?:founder|owner|ceo)\b/i)[0]));
    }
  }
  return names;
}

export function isLinkedInSelfOrCompanyLabel(value: string): boolean {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return true;
  if (/\bbrevmont\b/i.test(raw)) return true;
  const key = normalizePersonKey(raw.split(/\s+(?:founder|owner|ceo|head)\b/i)[0]);
  if (!key) return true;
  for (const self of linkedInSelfNames()) {
    if (self && (key === self || key.startsWith(self) || self.startsWith(key))) return true;
  }
  return false;
}

/** First-line lockup on a LinkedIn bubble ("Yancy Garcia Sent ya an email"). */
export function linkedInSenderLabelFromBubbleText(text: string): string {
  const first = String(text || '')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/ig, '')
    .replace(/\breact with\b.*$/i, '')
    .trim();
  if (!first) return '';
  const match = first.match(/^([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?){0,3})\b/);
  return (match?.[1] || '').trim();
}

/**
 * True when the bubble is the signed-in member's own send.
 * LinkedIn concatenates sender + body, so matching the whole blob against
 * the profile name always fails ("Yancy Garcia Sent ya an email" !== "Yancy Garcia").
 */
export function linkedInMessageLooksOutbound(text: string, personName?: string | null): boolean {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  const sender = linkedInSenderLabelFromBubbleText(text);
  if (sender && isLinkedInSelfOrCompanyLabel(sender)) return true;
  const firstLine = String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (firstLine.length < 80 && isLinkedInSelfOrCompanyLabel(firstLine)) return true;
  const personFirst = String(personName || '').trim().split(/\s+/)[0];
  if (personFirst && personFirst.length >= 2) {
    const escaped = personFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const greeting = new RegExp(`^hey\\s+${escaped}\\b`, 'i');
    const withoutSender = sender ? raw.slice(sender.length).trim() : raw;
    if (greeting.test(raw) || greeting.test(withoutSender)) return true;
  }
  return false;
}

export function linkedInBubbleLooksOutbound(el: HTMLElement, text: string, personName?: string | null): boolean {
  const classBlob = `${el.className || ''} ${el.parentElement?.className || ''}`;
  if (/message-group--self|(?:^|[\s_-])self(?:$|[\s_-])/i.test(classBlob)) return true;
  if (el.closest('[class*="message-group--self"]')) return true;
  const nameEl = el.querySelector(
    '.msg-s-message-group__name, .msg-s-event-listitem__name, [data-anonymize="person-name"]',
  ) as HTMLElement | null;
  const lockup = String(nameEl?.textContent || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  if (lockup && isLinkedInSelfOrCompanyLabel(lockup)) return true;
  return linkedInMessageLooksOutbound(text, personName);
}

function cleanLinkedInPersonLabel(value: string): string | null {
  const first = value.split('\n')[0].replace(/\s+/g, ' ').trim();
  const name = first
    .replace(/^(?:messaging|messages|linkedin)\s+/i, '')
    .replace(/\bsponsored(?:\s+messaging(?:\s+ad)?)?\b/ig, ' ')
    .replace(/\b(?:get started|learn more|not interested)\b/ig, ' ')
    .split(/\s+[·•|]\s+/)[0]
    .replace(/\s+[-–—].*$/, '')
    .replace(/\s+\(.*\)$/, '')
    .replace(/\s+(?:head of|founder|owner|ceo)\b.*$/i, '')
    .replace(/(founder|owner|ceo),?\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (isLikelyUiName(name) || isChannelOrUiName(name)) return null;
  if (/\bbrevmont\b/i.test(name)) return null;
  return name;
}

function isLinkedInListSurface(el: HTMLElement | null): boolean {
  return Boolean(
    el?.closest('.scaffold-layout__list, [class*="msg-conversations-container__conversations-list"], [class*="msg-conversation-list"]')
  );
}

function substantialLinkedInPane(start: HTMLElement | null, min = 40): HTMLElement | null {
  let best: HTMLElement | null = null;
  let cur: HTMLElement | null = start;
  while (cur && cur !== document.body) {
    if (isLinkedInListSurface(cur) || cur.matches('nav, header, .global-nav')) break;
    const text = deepVisibleText(cur, 4000);
    if (text.length >= min && !isLinkedInListSurface(cur)) best = cur;
    if (cur.matches('.scaffold-layout__detail, .msg-conversations-container__thread-view, [class*="thread-view"], [class*="scaffold-layout__detail"]')) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return best || start;
}

export function isLinkedInUiChromeText(value: unknown): boolean {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  return /open the options list/i.test(t)
    || /in your conversation with\b/i.test(t)
    || /^visible conversation text:/i.test(t)
    || /^detected lead context:/i.test(t)
    || /page inboxes/i.test(t)
    || /^react with\b/i.test(t);
}

export function linkedInThreadRoot(): HTMLElement | null {
  const href = String(window.location.href || '');
  const threadId = href.match(/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
  const composer = document.querySelector(
    '.msg-form__contenteditable, [aria-label*="Write a message" i][contenteditable="true"]',
  ) as HTMLElement | null;
  const fromComposer = substantialLinkedInPane(composer);
  const detail = (
    document.querySelector('.scaffold-layout__detail') as HTMLElement | null
    || document.querySelector('[class*="scaffold-layout__detail"]') as HTMLElement | null
  );
  const ctaInThread = Array.from((detail || document).querySelectorAll('button, a')).find((el) => {
    if (isLinkedInListSurface(el as HTMLElement)) return false;
    return /^(get started|learn more|not interested)$/i.test(String(el.textContent || '').replace(/\s+/g, ' ').trim());
  }) as HTMLElement | null;
  const candidates = [
    document.querySelector('.msg-conversations-container__thread-view') as HTMLElement | null,
    document.querySelector('.msg-overlay-conversation-bubble--is-active, .msg-overlay-conversation-bubble.is-active') as HTMLElement | null,
    fromComposer,
    detail,
    document.querySelector('.msg-s-message-list-content') as HTMLElement | null,
    threadId ? document.querySelector(`[data-thread-urn*="${CSS.escape(decodeURIComponent(threadId))}"]`) as HTMLElement | null : null,
    substantialLinkedInPane(ctaInThread),
  ];
  for (const el of candidates) {
    if (!el || isLinkedInListSurface(el)) continue;
    if (deepVisibleText(el, 4000).length > 24) return el;
  }
  return (document.querySelector('.msg-conversations-container__thread-view') as HTMLElement | null)
    || fromComposer
    || detail;
}

function normalizeLinkedInThreadPath(href: string): string {
  try {
    return decodeURIComponent(new URL(href, window.location.origin).pathname.replace(/\/$/, '')).toLowerCase();
  } catch {
    return String(href || '').toLowerCase();
  }
}

export function selectedLinkedInConversationName(): string | null {
  const href = String(window.location.href || '');
  const threadId = href.match(/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
  const decoded = threadId ? decodeURIComponent(threadId) : '';
  const path = normalizeLinkedInThreadPath(href);
  const matchingThreadLink = path
    ? Array.from(document.querySelectorAll('a[href*="/messaging/thread/"]')).find((anchor) => {
      return normalizeLinkedInThreadPath((anchor as HTMLAnchorElement).href) === path
        || (decoded && String((anchor as HTMLAnchorElement).getAttribute('href') || '').includes(decoded));
    }) as HTMLElement | null
    : null;
  const selected = (
    matchingThreadLink
    || (decoded ? document.querySelector(`a[href*="${CSS.escape(decoded)}"]`) as HTMLElement | null : null)
    || document.querySelector('.msg-conversation-listitem--active, .msg-selectable-entity--selected, [aria-current="true"]') as HTMLElement | null
    || document.querySelector('.scaffold-layout__list [aria-current="true"], .scaffold-layout__list [aria-selected="true"]') as HTMLElement | null
    || document.querySelector('a[href*="/messaging/thread/"][aria-current="true"]') as HTMLElement | null
  );
  if (!selected) return null;
  const row = (selected.closest('li, [role="listitem"], .msg-conversation-listitem, a') as HTMLElement | null) || selected;
  const lines = deepVisibleText(row, 800)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^sponsored\b/i.test(line)) continue;
    const name = cleanLinkedInPersonLabel(line);
    if (name && !isLinkedInSelfOrCompanyLabel(name)) return name;
  }
  return null;
}

const LINKEDIN_PRONOUN_RE = /\((?:he|she|they)\/(?:him|her|them)\)/i;

export function extractLinkedInPersonNameFromText(text: string): string | null {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const pronoun = raw.match(new RegExp(`([A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){1,3})\\s*${LINKEDIN_PRONOUN_RE.source}`, 'i'));
  if (pronoun) {
    const name = cleanLinkedInPersonLabel(pronoun[1]);
    if (name && !isLinkedInSelfOrCompanyLabel(name)) return name;
  }
  const timed = raw.match(/([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/);
  if (timed) {
    const name = cleanLinkedInPersonLabel(timed[1].replace(LINKEDIN_PRONOUN_RE, ''));
    if (name && !isLinkedInSelfOrCompanyLabel(name)) return name;
  }
  return null;
}

/** Person on a LinkedIn profile or DM thread. Never the Messaging chrome, Ad Options, or the signed-in profile. */
export function extractLinkedInPersonName(): string | null {
  const href = window.location.href;
  if (isLinkedInFeedOrChromeSurface(href)) return null;
  const messaging = isLinkedInMessagingSurface(href);
  if (!messaging) {
    const profile = document.querySelector('main h1.text-heading-xlarge, .pv-text-details__left-panel h1, .ph5 h1, h1.text-heading-xlarge') as HTMLElement | null;
    const name = cleanLinkedInPersonLabel(profile?.innerText || profile?.textContent || '');
    if (name && !isLinkedInSelfOrCompanyLabel(name)) return name;
    return null;
  }
  const threadRoot = linkedInThreadRoot();
  const scopes: Array<ParentNode | null> = [
    threadRoot,
    document.querySelector('.msg-conversation-listitem--active, .msg-selectable-entity--selected, li[aria-selected="true"]'),
    document.querySelector('main, [role="main"]'),
    threadRoot ? null : document.body,
  ];
  const fromList = selectedLinkedInConversationName();
  if (fromList) return fromList;
  const selectors = [
    '.msg-overlay-bubble-header__title',
    '.msg-thread__link-to-profile',
    '.msg-entity-lockup__entity-title',
    '.msg-s-message-group__name',
    '.msg-s-event-listitem__name',
    '.msg-conversation-card__participant-names',
    '[data-anonymize="person-name"]',
    'h1',
    'h2',
    'h3',
    '[role="heading"]',
  ];
  for (const scope of scopes) {
    if (!scope) continue;
    for (const selector of selectors) {
      for (const node of Array.from(scope.querySelectorAll(selector)) as HTMLElement[]) {
        if (node.closest('header, .global-nav, .feed-identity-module, .scaffold-layout__list')) continue;
        const name = cleanLinkedInPersonLabel(node.innerText || node.textContent || '');
        if (name && !isLinkedInSelfOrCompanyLabel(name)) return name;
      }
    }
  }
  return extractLinkedInPersonNameFromText(deepVisibleText(threadRoot || document.querySelector('[role="main"]'), 2500));
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

function isShownElement(el: Element): boolean {
  const node = el as HTMLElement;
  if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

/** Standalone Gmail compose overlay, not the inline Reply box on an open thread. */
export function isStandaloneGmailCompose(el: Element): boolean {
  const label = (el.getAttribute('aria-label') || '').toLowerCase();
  if (/new message|compose window|(?:^|\s)compose(?:\s|$)/.test(label) && !/\breply\b/.test(label)) {
    return isShownElement(el);
  }
  if (/^forward\b/.test(label) && el.getAttribute('role') === 'dialog') return isShownElement(el);
  if (/\breply\b/.test(label)) return false;
  if (el.getAttribute('role') === 'dialog' && el.querySelector('input[name="subjectbox"]')) {
    return isShownElement(el);
  }
  return false;
}

export function getActiveComposeRoot(platform: string): Element | null {
  if (platform !== 'gmail') return null;
  const candidates = Array.from(document.querySelectorAll('div[role="dialog"], [role="region"][aria-label*="compose" i]'));
  return candidates.find((el) => isStandaloneGmailCompose(el)) || null;
}

export function hasActiveComposeSurface(platform: string): boolean {
  return Boolean(getActiveComposeRoot(platform));
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
    const composeRoot = getActiveComposeRoot(platform);
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
    // No compose dialog open — read the currently-viewed thread sender.
    // Never use [data-name], h2, or .go: Gmail stamps the subject there, which
    // made the customer box flicker between the subject and empty.
    const subject = String((document.querySelector('h2.hP, .hP, [role="main"] h2') as HTMLElement | null)?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const senderEl = document.querySelector(
      '[role="main"] .gD[email], [role="main"] .gD[name], [role="main"] span.gD, .adn [email], .h7 [email], .gD[email]',
    ) as HTMLElement | null;
    if (senderEl) {
      const name = String(senderEl.getAttribute('name') || senderEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (name && name.length > 1 && name.length < 60 && !name.includes('@') && name.toLowerCase() !== subject) {
        return name;
      }
    }
    return null;
  }
  if (platform === 'facebook') {
    // Every candidate below must pass isChannelOrUiName() BEFORE being
    // returned. Marketplace conversations put "Messenger" in the top h1,
    // which was leaking through as customer_name until 2026-07-02.
    //
    // Preferred source on messenger.com/marketplace: the marketplace
    // thread lists "<Buyer> · <Listing title>" or "<Buyer> · Buyer" near
    // the top. Prefer aria-label paths that explicitly name a person.
    const labelled = Array.from(document.querySelectorAll('[aria-label]')).find(el => {
      const label = el.getAttribute('aria-label') || '';
      return /^(?:Message|Conversation\s+\w+|Profile picture of|Open profile for)\s+/i.test(label);
    });
    if (labelled) {
      const label = labelled.getAttribute('aria-label') || '';
      const cleaned = stripConversationWrapper(label)
        .replace(/\s+(?:profile|conversation)$/i, '')
        .trim();
      if (cleaned && cleaned.length > 1 && cleaned.length < 50 && !cleaned.includes('@') && !isChannelOrUiName(cleaned)) {
        return cleaned;
      }
    }
    const convoHeader = document.querySelector('[aria-label^="Conversation" i]');
    if (convoHeader) {
      const label = convoHeader.getAttribute('aria-label') || '';
      const candidate = stripConversationWrapper(label);
      if (candidate && candidate.length > 1 && !isChannelOrUiName(candidate)) return candidate;
    }
    // Try Marketplace-specific "<Buyer> · <Listing>" pattern near the top
    // of the thread — that's where "Mark · 2015 Subaru Outback 3.6R" is.
    const marketplaceHeader = document.querySelector('[role="main"] h1, [role="main"] h2');
    if (marketplaceHeader) {
      const raw = ((marketplaceHeader as HTMLElement).innerText || marketplaceHeader.textContent || '').trim();
      // Split on · (middle dot), • (bullet), or - to grab the name half.
      const firstSegment = stripConversationWrapper(raw.split(/\s*[·•·•-]\s*/)[0]?.trim() || raw);
      if (
        firstSegment &&
        firstSegment.length > 1 &&
        firstSegment.length < 50 &&
        !firstSegment.includes('@') &&
        !isChannelOrUiName(firstSegment)
      ) {
        return firstSegment;
      }
    }
    // Fall back to any header span, but reject channel names.
    const headerSpan =
      document.querySelector('[aria-label*="Profile"] h1') ||
      document.querySelector('[data-testid="mwthreadlist-item-open"] span') ||
      document.querySelector('div[role="main"] h2 span') ||
      document.querySelector('div[role="banner"] a[role="link"] span') ||
      document.querySelector('[role="main"] strong a[role="link"] span') ||
      document.querySelector('[role="main"] a[role="link"][href*="/profile.php"] span') ||
      document.querySelector('[role="main"] a[role="link"][href^="/"] span');
    if (headerSpan) {
      const name = (headerSpan as HTMLElement).textContent?.trim();
      if (name && name.length > 1 && name.length < 50 && !name.includes('@') && !isChannelOrUiName(name)) {
        return name;
      }
    }
    if (window.location.hostname.includes('messenger.com')) {
      const title = document.title
        .replace(/ - .*$/, '')
        .replace(/\s+\|\s+(?:Messenger|Facebook).*$/i, '')
        .replace(/\s*[·•-]\s*(?:19|20)\d{2}\b.*$/i, '')
        .replace(/\(\d+\)\s*/, '')
        .trim();
      if (title && title.length > 1 && title.length < 50 && !isChannelOrUiName(title)) return title;
    }
    return null;
  }
  if (platform === 'linkedin') {
    return extractLinkedInPersonName();
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
