/**
 * X (x.com) DM adapter — x.com/i/chat/ and x.com/messages/ conversations.
 *
 * V1 scope (2026-09-23, patterned directly after instagram.ts, the most
 * recent and most scrutinized native-DM adapter in this codebase): read
 * the ACTIVE 1:1 DM thread the rep already has open, extract enough
 * context for the existing Lead Responder Generate workflow, and
 * support manual copy/paste into the composer. No automation, no
 * inbox crawling, no undocumented API calls — only what the
 * authenticated user can already see on screen, matching every other
 * adapter's contract. Manual-context mode (the current X behavior)
 * remains fully intact regardless of anything in this file: it is
 * driven entirely by `autoThreadScanStatus !== 'ready'` in the side
 * panel, which is what an empty/failed scrapeThread() naturally
 * produces.
 *
 * ============================================================
 * READ THIS BEFORE TOUCHING A SELECTOR IN THIS FILE
 * ============================================================
 * THIS ADAPTER HAS NEVER BEEN RUN AGAINST LIVE X. Every DOM selector
 * below is reasoned from documented/known X web-app conventions
 * (semantic role/ARIA landmarks, X's known heavy use of `data-testid`,
 * stable route/URL shapes) — NOT from live DevTools inspection, because
 * this sandbox cannot load real x.com. Instagram's adapter, built
 * earlier the same day, made exactly this mistake once already: its
 * fixtures assumed a `<header>` element wrapped the counterpart's name,
 * all 87 tests passed, and it was still completely broken live because
 * real Instagram has no `<header>` element at all. To not repeat that:
 *   1. Every selector chain below tries semantic role/ARIA first,
 *      `data-testid` second, and a structural/positional fallback
 *      third — never a single guessed chain.
 *   2. The structural fallback (readHeadingNearProfileLink) makes NO
 *      assumption about a specific wrapper tag (no `<header>` guess) —
 *      it climbs from a profile link to the smallest ancestor with
 *      exactly one heading, which is shape-based, not markup-name-based.
 *   3. Message-row discovery unions a testid/role candidate set with a
 *      generic `div[dir="auto"]` leaf-text candidate set — the leaf-text
 *      approach is what actually rescued Instagram's live bug, so it is
 *      the PRIMARY strategy here, not an afterthought.
 *   4. Every fixture in tests/x-thread-scan.spec.ts includes at least
 *      one adversarial case where the "expected" markup shape (a
 *      dedicated header wrapper, a `data-testid` match) is ABSENT, to
 *      prove the fallback chain — not just the happy path — actually
 *      fires.
 *   5. Sender attribution (ME vs OTHER) uses the same left/right
 *      bubble-alignment geometry heuristic Instagram uses. This is the
 *      single highest-risk assumption in the whole file — see the
 *      comment on hasOpenXThread/scrapeThread below and item G in the
 *      founder report. If X's real layout doesn't right-align the
 *      rep's own bubbles, direction degrades to 'unknown' rather than
 *      guessing; it never reports a customer's words as the rep's own
 *      or vice versa without a real geometric signal.
 *
 * VERDICT: this file is READY FOR LIVE TEST, not "done." A live
 * DevTools pass against a real x.com DM thread (same pattern as the
 * Instagram fix earlier today) should be treated as the next required
 * step, not an optional polish pass.
 *
 * ROUTES RECOGNIZED (see also registry.ts's platformIdFromUrl, which
 * must stay in lockstep with hostMatches() below):
 *   - x.com/i/chat/<conversation-id>   — current XChat thread route
 *     (the one route explicitly confirmed in the founder's own spec).
 *   - x.com/messages/<id>-<id>         — legacy Twitter DM conversation
 *     route (numeric-id-hyphen-numeric-id shape), kept in case X still
 *     serves it for some sessions/rollouts.
 *   - x.com/messages (bare, no id)     — DM inbox root, no thread
 *     selected. Routed so hasOpenXThread() can correctly answer "false"
 *     for it (mirrors Instagram's /direct/inbox handling) rather than
 *     the router silently treating it as "no adapter."
 * x.com/home, x.com/<username>, x.com/<username>/status/<id> are
 * deliberately NOT matched — those are feed/profile/post pages, never
 * an active DM thread, per the founder's explicit spec item 2.
 *
 * SPA NAVIGATION: like every other adapter, this file runs no
 * navigation observer of its own. It is re-invoked fresh on each
 * SCAN_LEAD_V2 / INJECT_CONTENT_V2 message from the side panel, which
 * always reads `window.location.href` and the live DOM at call time.
 * X is a heavy SPA (arguably heavier than Instagram — most reps will
 * reach a DM thread by clicking around inside x.com, never via a fresh
 * page load), so unlike Instagram's adapter this file's hostMatches()
 * intentionally mirrors facebook.ts's broad top-level PLATFORM
 * assignment in content.ts (any x.com URL keeps the content script's
 * message listeners alive for that tab) while this file's own
 * hasOpenXThread() — not the content-script injection gate — is what
 * actually narrows "is a thread open right now."
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
import { extractVehicleHint, stableKeyFromPath } from './shared';
import { classifyXBubble, isXNoiseText } from '../xMessageText';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true,
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'social_dm',
  default_output: 'text',
};

// FRAGILE — see file header. /i/chat/<id> is the one route confirmed in
// the founder's spec; the legacy /messages/<id>-<id> shape and the bare
// /messages inbox root are reasoned from documented Twitter/X history,
// not confirmed live.
//
// CONFIRMED LIVE (2026-09-23): clicking into Messages on real X actually
// lands on the BARE route `/i/chat` (no id, no `/messages` anywhere) —
// not `/messages` as originally assumed. hasOpenXThread() below already
// handles this correctly without needing INBOX_ROOT_RE to match it:
// CHAT_PATH_RE requires a trailing id segment after `/i/chat/`, so bare
// `/i/chat` already fails `hasThreadId` and returns false. The gap this
// live evidence actually exposed was in registry.ts's platformIdFromUrl,
// which required a trailing slash on `/i/chat/` and only otherwise
// checked `/messages` shapes — bare `/i/chat` fell through to `null`
// there (X not recognized as a platform at all). Fixed there, not here.
const CHAT_PATH_RE = /\/i\/chat\/([^/?#]+)/i;
const LEGACY_DM_PATH_RE = /\/messages\/(\d+-\d+)(?:[/?#]|$)/i;
const INBOX_ROOT_RE = /^\/messages\/?$/i;

// Reserved single-segment path words that are X's own nav/route chrome,
// never a real handle — used to reject false-positive "profile link"
// matches when climbing the DOM for the counterpart's identity link.
// (Mirrors the intent of isChannelOrUiName, scoped to path segments.)
const RESERVED_PATH_SEGMENTS = new Set([
  'home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search',
  'settings', 'communities', 'jobs', 'bookmarks', 'lists', 'grok', 'premium',
  'premium_sign_up', 'verified', 'business', 'about', 'tos', 'privacy',
  'help', 'download', 'account', 'logout', 'login', 'signup', 'share',
]);

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  if (!u.includes('x.com')) return false;
  return u.includes('x.com/i/chat') || u.includes('x.com/messages');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

/** Thread id from the URL when present, else a path-based fallback key
 *  so the value is at least stable per-URL (mirrors instagram.ts). */
function conversationKey(): string {
  try {
    const path = window.location.pathname;
    const chat = path.match(CHAT_PATH_RE);
    if (chat?.[1]) return `chat:${chat[1]}`;
    const legacy = path.match(LEGACY_DM_PATH_RE);
    if (legacy?.[1]) return `dm:${legacy[1]}`;
  } catch {
    /* noop */
  }
  return stableKeyFromPath('x');
}

/** True only when the URL names a specific conversation AND a composer
 *  for it is actually rendered — the same "URL + DOM both agree"
 *  pattern every other adapter's thread-open gate uses, so "X detected,
 *  no conversation selected" (inbox root, compose-new-message) reliably
 *  returns an empty-but-valid context instead of scraping inbox chrome. */
export function hasOpenXThread(): boolean {
  const path = window.location.pathname;
  const hasThreadId = CHAT_PATH_RE.test(path) || LEGACY_DM_PATH_RE.test(path);
  if (!hasThreadId || INBOX_ROOT_RE.test(path)) return false;
  try {
    return Boolean(findComposer());
  } catch {
    return false;
  }
}

/** Composer resolution — multiple independent fallback strategies,
 *  weakest-committal first (per critical-lesson instructions: never a
 *  single guessed selector chain).
 *  CONFIRMED against live X (2026-09-23, DevTools on a real open DM
 *  thread): the composer is a `<textarea data-testid="dm-composer-textarea"
 *  placeholder="Message" aria-label="Message">` — NOT a contenteditable
 *  div, which every selector below originally guessed and which is why
 *  hasOpenXThread() was returning false on a real, open thread with a
 *  populated conversation. The confirmed exact testid is now primary;
 *  the original contenteditable guesses are kept as fallbacks in case
 *  X ships a different composer shape in some rollout/surface. */
// Ordered, weakest-committal-first. Kept as a list (not inlined into
// findComposer) so inject() can report a composer_selector string that
// ACTUALLY resolves via a fresh document.querySelector() call — the
// live bug found 2026-09-23: inject() previously always returned the
// hardcoded old contenteditable-div guess as composer_selector no
// matter which fallback here actually matched, and content.ts's
// INJECT_CONTENT_V2 handler re-queries by that exact string rather
// than reusing the element findComposer() found. On real X (a
// `<textarea data-testid="dm-composer-textarea">`) that hardcoded
// string matched nothing, so Inject failed with
// "composer_selector_resolved_null" even though scrapeThread/Generate
// worked correctly moments earlier using findComposer() directly.
const COMPOSER_SELECTORS = [
  'textarea[data-testid="dm-composer-textarea"]',
  'textarea[aria-label*="message" i]',
  'div[role="textbox"][contenteditable="true"][data-testid*="dmComposer" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="message" i]',
  '[data-testid="dm-message-scroller"] div[role="textbox"][contenteditable="true"]',
  '[role="main"] div[role="textbox"][contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
];

/** Composer resolution — multiple independent fallback strategies,
 *  weakest-committal first (per critical-lesson instructions: never a
 *  single guessed selector chain).
 *  CONFIRMED against live X (2026-09-23, DevTools on a real open DM
 *  thread): the composer is a `<textarea data-testid="dm-composer-textarea"
 *  placeholder="Message" aria-label="Message">` — NOT a contenteditable
 *  div, which every selector below originally guessed and which is why
 *  hasOpenXThread() was returning false on a real, open thread with a
 *  populated conversation. The confirmed exact testid is now primary;
 *  the original contenteditable guesses are kept as fallbacks in case
 *  X ships a different composer shape in some rollout/surface. */
function findComposer(): HTMLElement | null {
  for (const sel of COMPOSER_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

/** The scrollable message-list container. Tried as several independent
 *  candidates (testid, aria landmark, structural) rather than one
 *  guessed selector, per the critical-lesson instructions. Falls back
 *  to [role="main"] itself, mirroring instagram.ts.
 *  CONFIRMED against live X (2026-09-23): the real testid is the exact
 *  string "dm-message-scroller" (hyphenated, lowercase) — the original
 *  `*="DmScroller" i` substring guess never matched it, since
 *  "dm-message-scroller" does not contain "dmscroller" as a contiguous
 *  substring. The exact match is now primary; the old guess is kept as
 *  a fallback. */
function findThreadContainer(): HTMLElement | null {
  return (
    (document.querySelector('[data-testid="dm-message-scroller"]') as HTMLElement | null) ||
    (document.querySelector('[data-testid="dm-message-list"]') as HTMLElement | null) ||
    (document.querySelector('[data-testid*="DmScroller" i]') as HTMLElement | null) ||
    (document.querySelector('[aria-label*="Timeline: Messages" i]') as HTMLElement | null) ||
    (document.querySelector('[role="main"]') as HTMLElement | null) ||
    null
  );
}

/** Structural fallback for the counterpart's display name when no
 *  dedicated header wrapper/testid is present at all. Deliberately
 *  makes NO assumption about a specific wrapper tag (no `<header>`
 *  guess — that exact assumption is what broke Instagram live earlier
 *  today). Climbs from a profile link to the smallest ancestor
 *  containing exactly one heading; stops the instant a second heading
 *  appears (which would mean climbing merged into a shared container,
 *  e.g. one that also holds the rep's own identity). Purely shape-based,
 *  so it needs no knowledge of the rep's own handle. UNVERIFIED against
 *  live X — this is the adversarial case tests/x-thread-scan.spec.ts
 *  exercises directly (a fixture with no dedicated header element at all). */
function readHeadingNearProfileLink(): HTMLElement | null {
  try {
    const container = findThreadContainer();
    if (!container) return null;
    const link = Array.from(container.querySelectorAll('a[href^="/"]')).find((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,20})\/?$/);
      return Boolean(m && !RESERVED_PATH_SEGMENTS.has(m[1].toLowerCase()));
    }) as HTMLElement | null;
    if (!link) return null;
    let el: HTMLElement | null = link;
    let candidate: HTMLElement | null = null;
    let depth = 0;
    while (el && depth < 15) {
      const heads = el.querySelectorAll('h1, h2, [role="heading"]');
      if (heads.length === 1) {
        candidate = heads[0] as HTMLElement;
      } else if (heads.length > 1) {
        break;
      }
      el = el.parentElement;
      depth++;
    }
    return candidate;
  } catch {
    return null;
  }
}

/** Header anchor resolution — testid guess, then role/ARIA, then the
 *  no-wrapper-assumed structural fallback above.
 *  CONFIRMED against live X (2026-09-23): X exposes the counterpart's
 *  display name directly at `[data-testid="dm-conversation-username"]`
 *  (despite the "username" name, it holds the display name text, e.g.
 *  "Jayson hanz" — confirmed live), inside `[data-testid="dm-conversation-header"]`.
 *  Both are exact exact-string matches now tried first; the original
 *  substring/role guesses are kept as fallbacks. */
function readHeaderAnchor(): HTMLElement | null {
  try {
    return (
      (document.querySelector('[data-testid="dm-conversation-username"]') as HTMLElement | null) ||
      (document.querySelector('[data-testid="dm-conversation-header"]') as HTMLElement | null) ||
      (document.querySelector('[data-testid*="DmHeader" i] [role="heading"]') as HTMLElement | null) ||
      (document.querySelector('[data-testid*="conversation-header" i] [role="heading"]') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header h1') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header h2') as HTMLElement | null) ||
      readHeadingNearProfileLink()
    );
  } catch {
    return null;
  }
}

function readHeaderText(): string {
  const anchor = readHeaderAnchor();
  return (anchor?.innerText || anchor?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Profile link + handle visible near the thread header, if any. X
 *  profile hrefs are "/username" (no trailing slash, unlike Instagram's
 *  "/username/") — both are accepted defensively since this is
 *  unverified against live markup. */
function readHeaderProfileLink(): { username: string | null; profile_url: string | null } {
  try {
    const container = findThreadContainer();
    const scope = container || document;
    const candidates = Array.from(scope.querySelectorAll('a[href^="/"]')) as HTMLAnchorElement[];
    for (const link of candidates.slice(0, 30)) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,20})\/?$/);
      if (!m) continue;
      const seg = m[1].toLowerCase();
      if (RESERVED_PATH_SEGMENTS.has(seg)) continue;
      return {
        username: m[1],
        profile_url: `https://x.com/${m[1]}`,
      };
    }
  } catch {
    /* noop */
  }
  return { username: null, profile_url: null };
}

function emptyThread(): ThreadContext {
  return {
    conversation_key: conversationKey(),
    raw_text: '',
    messages: [],
    last_inbound_text: '',
    header_text: '',
    url: window.location.href,
    scanned_at: Date.now(),
    message_count: 0,
  };
}

function scrapeThread(): ThreadContext {
  if (!hasOpenXThread()) return emptyThread();

  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    const container = findThreadContainer();
    if (container) {
      // Candidate message rows — union of a testid/role candidate set
      // AND a generic dir="auto" text-leaf candidate set, exactly
      // mirroring instagram.ts's already-proven strategy (the leaf-text
      // approach is what rescued Instagram's live bug when the
      // role/testid guesses alone matched nothing but screen-reader
      // chrome).
      // CONFIRMED against live X (2026-09-23): each message wrapper
      // carries `data-testid="message-<uuid>"` (a real per-message id,
      // not the guessed "messageEntry" substring, which never matched
      // anything). The `message-text-<uuid>` siblings/children are
      // excluded here since the wrapper's own innerText already
      // includes them, and the wrapper's className is what direction
      // detection below actually needs.
      const roleCandidates = Array.from(
        container.querySelectorAll('[data-testid^="message-"]:not([data-testid^="message-text-"]), [role="row"], [aria-label*="Message" i]')
      );
      const composerBox = findComposer();
      // Excludes anything already inside a roleCandidates match (the
      // message-<uuid> wrapper's own innerText already includes its
      // message-text-<uuid> child's content) — without this, every
      // message on real X would be double-counted: once via its
      // wrapper, once via the child text node independently matching
      // this generic dir="auto" scan. Confirmed live: message-text-
      // <uuid> nodes are dir="auto" leaves nested one level inside
      // their message-<uuid> parent.
      const textLeafCandidates = Array.from(container.querySelectorAll('div[dir="auto"]')).filter((el) => {
        if (composerBox && (el === composerBox || composerBox.contains(el) || el.contains(composerBox))) {
          return false;
        }
        if (!(el.textContent || '').trim()) return false;
        if (el.querySelector('div[dir="auto"]')) return false;
        if (roleCandidates.some((rc) => rc !== el && rc.contains(el))) return false;
        return true;
      });
      const seen = new Set<Element>();
      const merged: Element[] = [];
      for (const el of [...roleCandidates, ...textLeafCandidates]) {
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
      const bubbles = merged.slice(-40);
      const containerRect = container.getBoundingClientRect();
      const mid = containerRect.left + containerRect.width / 2;

      for (const b of bubbles) {
        const el = b as HTMLElement;
        const rawText = (el.innerText || '').replace(/\s+/g, ' ').trim();
        const postLink = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
        const hasImage = Boolean(el.querySelector('img:not([alt="Emoji"])'));
        const hasVideo = Boolean(el.querySelector('video'));
        const hasAudio = Boolean(el.querySelector('audio'));
        const isGif = Boolean(el.querySelector('img[src*="tenor" i], video[poster*="tenor" i], [aria-label="GIF" i]'));
        const hasMediaSignal = Boolean(postLink) || hasImage || hasVideo || hasAudio;
        if (!hasMediaSignal && isXNoiseText(rawText)) continue;

        const classified = classifyXBubble({
          text: rawText,
          hasImage,
          hasVideo,
          hasAudio,
          isGif,
          postHref: postLink?.getAttribute('href') || null,
        });
        if (!classified.text) continue;

        // SENDER ATTRIBUTION — originally the single highest-risk guess
        // in this file (bounding-rect left/right geometry, mirroring
        // Instagram). CONFIRMED LIVE this was actually broken: on real
        // X, the message wrapper's own bounding rect is full-width
        // (`w-full`) regardless of direction — every wrapper reports
        // the same rectLeft/rectWidth whether sent or received, because
        // alignment is done via flexbox `justify-content` on the
        // wrapper's own className, not by narrowing the wrapper itself.
        // Geometry would have silently produced 'unknown' or, worse,
        // misattributed every message. The wrapper's className reliably
        // carries `justify-end` (sent by the rep) or `justify-start`
        // (received from the counterpart) — a real structural signal,
        // confirmed against a live 16-message thread. This is now
        // primary; the geometry heuristic is kept ONLY as a fallback
        // for a candidate that isn't one of these testid'd wrappers
        // (e.g. a role="row"/aria-label match with no X className
        // convention at all), never overriding a confirmed class match.
        const className = String((el as HTMLElement).className || '');
        let direction: ThreadContext['messages'][number]['direction'] = 'unknown';
        if (/(?:^|\s)justify-end(?:\s|$)/.test(className)) {
          direction = 'outbound';
        } else if (/(?:^|\s)justify-start(?:\s|$)/.test(className)) {
          direction = 'inbound';
        } else {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && containerRect.width > 0 && rect.width < containerRect.width * 0.9) {
            const center = rect.left + rect.width / 2;
            direction = center > mid ? 'outbound' : 'inbound';
          }
        }
        messages.push({ text: classified.text.slice(0, 600), direction });
        if (direction === 'inbound' && classified.contentType === 'text') {
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
  if (!hasOpenXThread()) return { name: null };
  try {
    const { username, profile_url } = readHeaderProfileLink();
    const header = readHeaderText();
    if (header && header.length > 1 && header.length < 60) {
      // Strip trailing X-specific decorators ("@handle", presence dots).
      const cleaned = header
        .replace(/\s*@[A-Za-z0-9_]{1,20}\s*$/i, '')
        .replace(/\s*[·•]\s*(?:Active|Online|Offline|typing).*$/i, '')
        .trim();
      if (cleaned && cleaned.length > 1) {
        return {
          name: cleaned,
          username,
          profile_url,
          raw_source: 'x_thread_header',
          confidence: 0.8,
        };
      }
    }
    // No legible display name — still surface username/profile_url so
    // generation can at least use the handle instead of guessing (core's
    // isChannelOrUiName gate still runs on name).
    if (username) {
      return {
        name: null,
        username,
        profile_url,
        raw_source: 'x_header_profile_link_only',
        confidence: 0.4,
      };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  if (!hasOpenXThread()) {
    return { vehicle: null, vehicle_year: null, vehicle_make: null, vehicle_model: null };
  }
  const body = (findThreadContainer()?.innerText || '').slice(0, 4000);
  const vh = extractVehicleHint(body);
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
  };
}

async function inject(_text: string, kind: InjectKind): Promise<InjectResult> {
  if (kind !== 'text') {
    return { ok: false, reason: 'x_only_supports_text_inject' };
  }
  const box = findComposer();
  if (!box) return { ok: false, reason: 'no_x_compose_found' };
  // FIXED live bug (2026-09-23): this used to always return the
  // hardcoded old contenteditable-div guess here regardless of which
  // COMPOSER_SELECTORS entry actually matched `box` — content.ts's
  // inject handler re-queries the DOM fresh by this exact string
  // (it does not reuse `box` itself), so on real X the returned
  // selector matched nothing and Inject failed with
  // "composer_selector_resolved_null" even though `box` was found
  // correctly one line above. Report whichever selector in the same
  // list findComposer() used actually matches the found element, so
  // the downstream re-query resolves to the same composer.
  const matchedSelector = COMPOSER_SELECTORS.find((sel) => {
    try {
      return box.matches(sel);
    } catch {
      return false;
    }
  }) || COMPOSER_SELECTORS.join(', ');
  return {
    ok: true,
    method: 'x_dm_composer',
    composer_selector: matchedSelector,
  };
}

export const xAdapter: PlatformAdapter = {
  id: 'x',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
