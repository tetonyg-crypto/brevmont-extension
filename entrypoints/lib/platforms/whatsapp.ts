/**
 * WhatsApp Web adapter — web.whatsapp.com.
 *
 * ============================================================
 * READ THIS BEFORE TOUCHING A SELECTOR IN THIS FILE
 * ============================================================
 * Prior state (before 2026-09-23 pass): a real adapter already existed
 * here (not "manifest match and prayed" as an earlier comment claimed —
 * SCAN_LEAD_V2 in content.ts already routed to this file's
 * scrapeThread()/extractCustomer()/extractContext(), and the sidepanel
 * already consumed thread.messages + thread.raw_text). A live test
 * (2026-09-23) showed Brevmont correctly recognizing platform=WhatsApp,
 * Lead Radar active, and "Replying to: Hi there" (the single visible
 * incoming message). The investigation for this pass found the adapter
 * was NOT fundamentally broken — it does read `#main`'s rendered
 * message bubbles — but had three real gaps, all fixed in this pass:
 *
 *   1. CONVERSATION IDENTITY (the headline bug — spec section 13/14).
 *      The old code called the generic `stableKeyFromPath('wa')` helper
 *      (shared.ts), which builds a key from `window.location.pathname +
 *      hash`. WhatsApp Web's URL is a SPA that NEVER changes per chat —
 *      it is always `https://web.whatsapp.com/` regardless of which
 *      contact is open. That means every single WhatsApp conversation
 *      produced the exact same `conversation_key` ("wa:/"), which is
 *      the wrong kind of "stable" — it doesn't distinguish Chat A from
 *      Chat B at all. `conversationKey()` below replaces that with a
 *      DOM-state-derived identity (see its own comment). The side
 *      panel's `scanUrlMatchesCurrent()` gate (sidepanel/main.ts) was
 *      ALSO fixed to never trust a cached WhatsApp scan across renders,
 *      for the same underlying reason — see the comment there.
 *   2. RESILIENCE. The old bubble/header/composer selectors were each a
 *      single guessed chain with only 2-3 fallbacks and no semantic/
 *      data-testid-first ordering, no rich-content classification, no
 *      reply/quote handling, and no noise-text filtering (WhatsApp
 *      system banners like "Message notifications are off." could have
 *      been scraped as if they were messages). All of that is added
 *      below, patterned directly after x.ts (built earlier the same
 *      day) and instagram.ts.
 *   3. SENDER ATTRIBUTION had only one signal (className `.message-in`/
 *      `.message-out`, or a `data-testid` substring check). A `.message-
 *      in`/`.message-out` classname convention is old, semi-public
 *      WhatsApp Web knowledge that has changed across WhatsApp Web
 *      releases before and may not be current. This pass adds a
 *      DOM-functional PRIMARY signal (each message row's own `data-id`
 *      attribute, which WhatsApp Web's React tree keys every message
 *      with in the well-documented `{fromMe}_{remoteJid}_{msgId}`
 *      shape used by every WhatsApp Web scraping tool/library) ahead of
 *      the className check, with geometry as the final fallback — see
 *      "SENDER ATTRIBUTION" comment below.
 *
 * NONE of this has been run against live WhatsApp Web — this sandbox
 * cannot load it. Every selector chain below tries a documented/
 * functional signal first, a className/testid guess second, and a
 * structural/geometric fallback third, per the critical-lesson
 * instructions (Instagram's `<header>` guess and X's `DmScroller`/
 * contenteditable-composer guesses were both wrong on live DOM despite
 * 87/100+ tests passing against fixtures). See the risk-ranked list in
 * the founder report (item T) for what to verify first in a live
 * DevTools pass.
 *
 * VERDICT: READY FOR LIVE TEST, not "done."
 *
 * WhatsApp has a heavy Spanish-speaking buyer population per spec, so
 * the customer extractor is careful to strip Spanish/Portuguese presence
 * decorators like "en línea" from header labels.
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
import { classifyWhatsAppBubble, isWhatsAppNoiseText } from '../whatsappMessageText';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true,
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'social_dm',
  default_output: 'text',
};

// Presence/status decorators to strip from header labels across
// English + Spanish + Portuguese (WhatsApp UI localizes).
const PRESENCE_DECORATORS_RE =
  /\s*(?:online|typing|typing[.]{3}|last seen[^,]*|activo|activa|escribiendo|en l[ií]nea|em linha|digitando|visto por[uú]ltima vez[^,]*)\s*$/i;

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('web.whatsapp.com');
}

// ---------------------------------------------------------------------
// THREAD-OPEN GATE
// ---------------------------------------------------------------------
// WhatsApp Web's URL never names a conversation, so "is a thread open
// right now" has to come from DOM state alone, unlike Instagram/X where
// a URL path segment can gate it. `#main` is the conversation panel;
// WhatsApp Web renders a distinct "select a chat to start messaging"
// placeholder pane (no `#main`, or a `#main` with no header/composer)
// when no contact is open. Mirrors X's hasOpenXThread() "URL + DOM both
// agree" pattern, minus the URL half (there is none here).
function findMainPanel(): HTMLElement | null {
  return document.querySelector('#main') as HTMLElement | null;
}

function hasOpenWhatsAppThread(): boolean {
  try {
    const main = findMainPanel();
    if (!main) return false;
    // A real open thread has both a header (contact identity) and a
    // composer rendered. Requiring both avoids treating a transient
    // loading frame or the "select a chat" welcome pane as an open
    // conversation.
    return Boolean(readHeaderAnchor()) && Boolean(findComposer());
  } catch {
    return false;
  }
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

// ---------------------------------------------------------------------
// HEADER / PARTICIPANT IDENTITY
// ---------------------------------------------------------------------
// Ordered, weakest-committal-first per the critical-lesson instructions:
// semantic/title-attribute first, data-testid second (WhatsApp Web is
// documented to use data-testid extensively), structural fallback third.
function readHeaderAnchor(): HTMLElement | null {
  try {
    const main = findMainPanel();
    const scope: ParentNode = main || document;
    return (
      (scope.querySelector('header span[title]') as HTMLElement | null) ||
      (scope.querySelector('[data-testid="conversation-header"] span[title]') as HTMLElement | null) ||
      (scope.querySelector('[data-testid="conversation-info-header-chat-title"]') as HTMLElement | null) ||
      (scope.querySelector('header span[dir="auto"][title]') as HTMLElement | null) ||
      (scope.querySelector('header [role="button"] span[dir="auto"]') as HTMLElement | null) ||
      // Structural fallback: no assumption about a specific wrapper tag
      // beyond "header exists" — the first single-heading-like span
      // inside it. Deliberately does NOT assume `<header>` is present
      // at all costs (that exact assumption broke Instagram live); if
      // WhatsApp ever drops the semantic `<header>` element, this whole
      // chain returns null and callers degrade to `{ name: null }`
      // rather than guessing.
      (scope.querySelector('header span[dir="auto"]') as HTMLElement | null)
    );
  } catch {
    return null;
  }
}

function readHeaderText(): string {
  try {
    const anchor = readHeaderAnchor();
    if (!anchor) return '';
    const raw = anchor.getAttribute('title') || anchor.innerText || anchor.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/** Subtitle line under the header name — for a 1:1 chat this is presence
 *  ("online", a phone number) or nothing; for a GROUP chat WhatsApp Web
 *  renders a comma-separated participant list here. Used only to detect
 *  group vs 1:1 (spec section 12) — never to attribute individual
 *  messages to a specific participant. UNVERIFIED selector: WhatsApp's
 *  subtitle uses the same `header span[title]`-style markup as the name
 *  line, so this reads the SECOND such span found, if any. */
function readHeaderSubtitleText(): string {
  try {
    const main = findMainPanel();
    const scope: ParentNode = main || document;
    const header = scope.querySelector('header');
    if (!header) return '';
    const spans = Array.from(header.querySelectorAll('span[title]')) as HTMLElement[];
    const nameText = readHeaderText();
    const subtitle = spans.find((s) => (s.getAttribute('title') || s.innerText || '').trim() !== nameText);
    return (subtitle?.getAttribute('title') || subtitle?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

/** Group vs 1:1 detection (spec section 12). Primary requirement is
 *  1:1; when a group is detected we still extract messages (direction
 *  is still reliably ME vs OTHER via data-id/className/geometry) but
 *  `extractCustomer()` returns the GROUP name, never a guessed single
 *  participant name, so no incoming message is ever misattributed to
 *  one person incorrectly. UNVERIFIED: reasoned from WhatsApp Web's
 *  known group-icon convention (`data-icon="default-group"`) and the
 *  comma-separated participant subtitle, not confirmed live. */
function isGroupChat(): boolean {
  try {
    const main = findMainPanel();
    const scope: ParentNode = main || document;
    if (scope.querySelector('header [data-icon="default-group"], header [data-icon*="group" i]')) return true;
    const subtitle = readHeaderSubtitleText();
    // A subtitle with 2+ comma-separated name-like segments and no
    // presence/phone-only shape is very likely a group participant list
    // ("You, Alex, Jordan" / "Alex, Jordan, +2 more").
    if (subtitle && /,/.test(subtitle) && !PRESENCE_DECORATORS_RE.test(subtitle) && !/^\+?\d[\d\s().-]{4,}$/.test(subtitle)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// CONVERSATION IDENTITY — see file header comment (gap #1).
// ---------------------------------------------------------------------
// WhatsApp Web's URL is invariant across chats, so identity has to come
// from DOM state, re-read fresh on every call (no caching — mirrors the
// pull-based pattern Instagram/X use for SPA navigation, per spec
// section 13). Priority:
//   1. A rendered message row's own `data-id` attribute. WhatsApp Web's
//      React tree was historically documented to key every message
//      element with an id of the shape `{true|false}_{remoteJid}_{msgId}`
//      (optionally with a trailing `_{participant}` in groups), which
//      would directly encode the JID (chat identity) the message
//      belongs to. CONFIRMED LIVE (2026-09-23, via direct browser
//      automation against a real, logged-in WhatsApp Web session,
//      several contacts checked): this build does NOT render any
//      `data-id` attribute on message rows at all — only a single,
//      unrelated `data-id` exists anywhere on the page, and it is not
//      a message. This signal will not fire on the current build; it
//      is kept only in case a future WhatsApp Web release reintroduces
//      it, and execution always falls through correctly to #2 below.
//   2. A stable hash of the header contact name ONLY (for unsaved
//      contacts the phone number is the name itself). The presence
//      subtitle is never part of the key — it changes while the same
//      chat stays open. CONFIRMED LIVE this is what actually resolves
//      identity on the current build, and correctly distinguishes
//      contacts even when no message row is rendered yet (empty/new
//      chat) — verified against three different real contacts.
//   3. `stableKeyFromPath('wa')` as an explicit last resort, tagged so
//      callers can tell identity degraded to the URL-invariant shape.
function extractJidFromDataId(value: string | null): string | null {
  if (!value) return null;
  // `{fromMe}_{remoteJid}_{msgId}` — remoteJid is the middle segment,
  // typically `<digits>@c.us`, `<digits>@s.whatsapp.net`, or
  // `<digits>-<digits>@g.us` for groups.
  const m = value.match(/^(?:true|false)_([^_]+)_/);
  return m ? m[1] : null;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function conversationKey(): string {
  try {
    const main = findMainPanel();
    if (main) {
      const rowWithId = main.querySelector('[data-id]');
      const jid = extractJidFromDataId(rowWithId?.getAttribute('data-id') || null);
      if (jid) return `wa_jid:${jid}`;
    }
    // Name only. The subtitle under it is a presence line that flips
    // between nothing / "online" / "typing…" / "last seen …" for the SAME
    // contact (and "Alex is typing…" in groups), so including it gave one
    // chat several keys and every flip looked like a thread switch
    // (clearing the pinned customer and wiping drafts). The name line
    // carries the phone number itself for unsaved contacts.
    const identity = readHeaderText().replace(PRESENCE_DECORATORS_RE, '').trim();
    if (identity) return `wa_header:${hashString(identity)}`;
  } catch {
    /* noop */
  }
  return stableKeyFromPath('wa_degraded');
}

// ---------------------------------------------------------------------
// MESSAGE EXTRACTION
// ---------------------------------------------------------------------
// Candidate message rows — union of a data-id/testid/role candidate set
// (semantic-ish, functional) AND a generic copyable-text leaf-text
// candidate set, mirroring x.ts's proven "union both, sort by DOM
// order, dedupe" strategy (the leaf-text approach is what rescued
// Instagram's live bug when role/testid guesses alone matched nothing).
function findMessageRowCandidates(main: HTMLElement): Element[] {
  const roleCandidates = Array.from(
    main.querySelectorAll('[data-id], [data-testid="msg-container"], .message-in, .message-out')
  );
  const composerBox = findComposer();
  const leafCandidates = Array.from(main.querySelectorAll('.copyable-text, span.selectable-text'))
    .filter((el) => {
      if (composerBox && (el === composerBox || composerBox.contains(el) || el.contains(composerBox))) return false;
      if (!(el.textContent || '').trim() && !el.querySelector('img, video, audio')) return false;
      return true;
    });
  const seen = new Set<Element>();
  const merged: Element[] = [];
  for (const el of [...roleCandidates, ...leafCandidates]) {
    // Prefer the outermost row (data-id owner) over a nested leaf that
    // it already contains, so each message counts once.
    const owned = merged.find((m) => m.contains(el) || el.contains(m));
    if (owned) continue;
    if (seen.has(el)) continue;
    seen.add(el);
    merged.push(el);
  }
  merged.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return merged;
}

/** Find the nearest ancestor (or self) carrying a `data-id` attribute —
 *  that's the actual message row WhatsApp Web keys, even when the
 *  matched candidate was a nested `.copyable-text` leaf. */
function nearestDataIdRow(el: Element): Element | null {
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 8) {
    if (node.hasAttribute('data-id')) return node;
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

/** Reply/quote preview block inside a message row, if present.
 *  UNVERIFIED selector — WhatsApp Web is known to render a distinct
 *  quoted-message preview above the reply's own text; the exact
 *  class/testid is unconfirmed here, so this tries several generic
 *  shapes and returns null (no reply context) rather than guessing
 *  wrong. */
function readQuotedText(row: Element): string | null {
  try {
    const quoted =
      row.querySelector('[data-testid*="quoted" i]') ||
      row.querySelector('[aria-label*="quoted" i]') ||
      row.querySelector('[class*="quoted" i]');
    if (!quoted) return null;
    const text = ((quoted as HTMLElement).innerText || quoted.textContent || '').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

function rowRichSignals(row: Element) {
  const q = (sel: string) => Boolean(row.querySelector(sel));
  return {
    hasImage: q('img:not([alt="Emoji"])') && !q('[data-icon*="sticker" i]'),
    hasVideo: q('video') || q('[data-icon="media-play" i]'),
    hasAudio: q('audio') || q('[data-icon*="audio" i]') || q('[data-icon*="mic" i]') || q('[data-icon="ptt" i]'),
    hasDocument: q('[data-icon*="doc" i]') || q('[data-testid*="document" i]'),
    isSticker: q('[data-icon*="sticker" i]') || /sticker/i.test(row.className || ''),
    isGif: q('[data-icon*="gif" i]') || q('img[alt="GIF" i]'),
    hasLocation: q('[data-icon*="location" i]') || q('[data-icon*="pin" i]'),
    hasContactCard: q('[data-icon*="contact" i]') || q('[data-testid*="vcard" i]'),
  };
}

// SENDER ATTRIBUTION — see file header comment (gap #3). CONFIRMED LIVE
// (2026-09-23, direct browser automation): neither `data-id` nor
// `.message-in`/`.message-out` exist on the current WhatsApp Web build,
// so direction resolution always falls through to the geometry
// fallback in practice today. That fallback was verified correct
// against real messages in both directions — an inbound message
// classified 'inbound', a confirmed rep-sent outbound message ("Cheka
// este", double-checkmark in the chat list) classified 'outbound'.
// Geometry is therefore not merely a safety net right now, it is the
// signal actually in effect; a wrong/missing structural signal still
// degrades to 'unknown' direction on an individual row rather than
// silently misattributing a customer's words as the rep's own or vice
// versa (the same policy X's adapter uses for its own highest-risk
// signal), but that degrade path was not exercised in this live check.
function attributeDirection(
  row: Element,
  el: Element,
  containerRect: DOMRect,
  mid: number
): ThreadContext['messages'][number]['direction'] {
  const dataIdRow = nearestDataIdRow(row) || nearestDataIdRow(el);
  const dataId = dataIdRow?.getAttribute('data-id') || '';
  if (/^true_/.test(dataId)) return 'outbound';
  if (/^false_/.test(dataId)) return 'inbound';

  const className = String((row as HTMLElement).className || (el as HTMLElement).className || '');
  if (/(?:^|\s)message-out(?:\s|$)/.test(className) || /out/i.test((row as HTMLElement).getAttribute?.('data-testid') || '')) {
    return 'outbound';
  }
  if (/(?:^|\s)message-in(?:\s|$)/.test(className)) return 'inbound';

  try {
    const rect = (row as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && containerRect.width > 0 && rect.width < containerRect.width * 0.92) {
      const center = rect.left + rect.width / 2;
      return center > mid ? 'outbound' : 'inbound';
    }
  } catch {
    /* noop */
  }
  return 'unknown';
}

function emptyThread(): ThreadContext {
  return {
    conversation_key: conversationKey(),
    raw_text: '',
    messages: [],
    last_inbound_text: '',
    header_text: readHeaderText(),
    url: window.location.href,
    scanned_at: Date.now(),
    message_count: 0,
  };
}

function scrapeThread(): ThreadContext {
  if (!hasOpenWhatsAppThread()) return emptyThread();

  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    const main = findMainPanel();
    if (main) {
      const candidates = findMessageRowCandidates(main);
      // Context-window cap (spec section 7): last 40 rendered messages,
      // most-recent priority — no unlimited transcript collection, and
      // WhatsApp's own virtualization means only what's currently
      // rendered is ever available anyway (spec section 8 — no
      // auto-scroll, no history crawl).
      const bubbles = candidates.slice(-40);
      const containerRect = main.getBoundingClientRect();
      const mid = containerRect.left + containerRect.width / 2;

      for (const b of bubbles) {
        const row = nearestDataIdRow(b) || b;
        const quotedText = readQuotedText(row);
        // When a reply/quote preview is present, its text must be
        // excluded from the row's OWN text before classification —
        // otherwise the quoted text would appear twice (once inside
        // `rawText`, once again via the `[replying to: "..."]` prefix).
        // Uses textContent on a detached clone (not innerText) because
        // innerText depends on layout, which a cloned/detached node
        // never has.
        let rawText: string;
        if (quotedText) {
          const clone = (row as HTMLElement).cloneNode(true) as HTMLElement;
          clone.querySelector('[data-testid*="quoted" i], [aria-label*="quoted" i], [class*="quoted" i]')?.remove();
          rawText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        } else {
          rawText = ((b as HTMLElement).innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        }
        const hasRichSignal = Boolean(row.querySelector('img, video, audio, [data-icon]'));
        if (!rawText && !hasRichSignal) continue;
        // The noise-text filter only applies to rows that actually have
        // text — an empty rawText on a rich-content-only row (image,
        // video, voice note with no caption) is normal and must not be
        // rejected as "noise" (isWhatsAppNoiseText('') is true by design
        // for genuinely empty/whitespace rows).
        if (rawText && isWhatsAppNoiseText(rawText)) continue;

        const signals = rowRichSignals(row);
        const classified = classifyWhatsAppBubble({ text: rawText, quotedText, ...signals });
        if (!classified.text) continue;

        const direction = attributeDirection(row, b, containerRect, mid);
        messages.push({ text: classified.text.slice(0, 600), direction });
        if (direction === 'inbound') {
          last_inbound_text = classified.text.slice(0, 2000);
        }
      }
    }
  } catch {
    /* noop */
  }
  const header_text = readHeaderText();
  const raw_text = [
    header_text,
    ...messages.map((m) => `[${m.direction}] ${m.text}`),
  ].filter(Boolean).join('\n').slice(0, 5000);
  return {
    conversation_key: conversationKey(),
    raw_text,
    messages,
    last_inbound_text,
    header_text,
    url: window.location.href,
    scanned_at: Date.now(),
    message_count: messages.length,
  };
}

function extractCustomer(): CustomerCandidate {
  if (!hasOpenWhatsAppThread()) return { name: null };
  try {
    const header = readHeaderText();
    if (!header) return { name: null };
    let cleaned = header.replace(PRESENCE_DECORATORS_RE, '').trim();

    // Phone-only labels shouldn't be treated as names. WhatsApp shows
    // phone numbers when the contact isn't saved; a naive "name" here
    // is a phone string like "+1 555 123 4567".
    if (/^\+?\d[\d\s().-]{4,}$/.test(cleaned)) {
      return { name: null, phone: cleaned.replace(/[^\d+]/g, ''), raw_source: 'wa_phone_only', confidence: 0.6 };
    }

    if (isGroupChat()) {
      // Never guess a single participant's identity for a group — the
      // group name is the only safe candidate (spec section 12).
      if (cleaned && cleaned.length > 1 && cleaned.length < 60) {
        return { name: cleaned, raw_source: 'wa_group_header', confidence: 0.5 };
      }
      return { name: null, raw_source: 'wa_group_unidentified', confidence: 0.2 };
    }

    if (cleaned && cleaned.length > 1 && cleaned.length < 60) {
      return { name: cleaned, raw_source: 'wa_header_title', confidence: 0.85 };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  if (!hasOpenWhatsAppThread()) {
    return { vehicle: null, vehicle_year: null, vehicle_make: null, vehicle_model: null };
  }
  const body = (findMainPanel()?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

// ---------------------------------------------------------------------
// COMPOSER / INJECT
// ---------------------------------------------------------------------
// Ordered, weakest-committal-first. Kept as a list (not inlined) so
// inject() can report a composer_selector that actually resolves via a
// fresh document.querySelector() — mirroring the corrected pattern in
// x.ts (a live bug there: inject() previously always returned a
// hardcoded selector string regardless of which fallback actually
// matched, so content.ts's INJECT_CONTENT_V2 handler's fresh re-query
// missed it). The `data-tab="10"` numbered-tab convention is
// WhatsApp-Web-specific semi-public knowledge that has shifted across
// releases before, so it is tried first (matches the pre-existing
// adapter's behavior) but not trusted alone.
const COMPOSER_SELECTORS = [
  'div[contenteditable="true"][data-tab="10"]',
  'footer div[contenteditable="true"]',
  '[data-testid="conversation-compose-box-input"]',
  'div[contenteditable="true"][data-lexical-editor="true"]',
  'div[contenteditable="true"][aria-label*="Type a message" i]',
  'div[contenteditable="true"][aria-label*="Escribe un mensaje" i]',
];

// findGenericComposer('text') (shared.ts) checks its own selectors —
// 'div[role="textbox"][contenteditable="true"]' and
// 'textarea:not([readonly])' — neither of which appears in
// COMPOSER_SELECTORS above. Without listing them here too, a composer
// found only via that fallback would make inject()'s composer_selector
// matching below fail to find it, silently falling back to the whole
// joined list — a string that would NOT reliably re-resolve to the same
// element on a fresh document.querySelector() call. That is exactly the
// live bug found and fixed in x.ts's inject() earlier today (a stale/
// mismatched composer_selector breaks content.ts's INJECT_CONTENT_V2
// re-query). Every selector findComposer() can possibly return through
// must be represented here so the match is never missed.
const GENERIC_COMPOSER_FALLBACK_SELECTORS = [
  'div[role="textbox"][contenteditable="true"]',
  'textarea:not([readonly])',
];

function findComposer(): HTMLElement | null {
  for (const sel of COMPOSER_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return findGenericComposer('text');
}

async function inject(_text: string, kind: InjectKind): Promise<InjectResult> {
  if (kind !== 'text') {
    return { ok: false, reason: 'whatsapp_only_supports_text_inject' };
  }
  const box = findComposer();
  if (!box) return { ok: false, reason: 'no_wa_composer_found' };
  const allSelectors = [...COMPOSER_SELECTORS, ...GENERIC_COMPOSER_FALLBACK_SELECTORS];
  const matchedSelector = allSelectors.find((sel) => {
    try {
      return box.matches(sel);
    } catch {
      return false;
    }
  }) || allSelectors.join(', ');
  return {
    ok: true,
    method: 'whatsapp_footer_composer',
    composer_selector: matchedSelector,
  };
}

export const whatsappAdapter: PlatformAdapter = {
  id: 'whatsapp',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};

// Exported for tests / debug only — not part of the PlatformAdapter
// contract.
export { hasOpenWhatsAppThread, conversationKey as whatsappConversationKey, isGroupChat as isWhatsAppGroupChat };
