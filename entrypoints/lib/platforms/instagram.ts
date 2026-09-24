/**
 * Instagram DM adapter — instagram.com/direct/ conversations.
 *
 * V1 scope (per founder spec, 2026-09-23): read the ACTIVE 1:1 DM
 * thread the rep already has open, extract enough context for the
 * existing Lead Responder Generate workflow, and support manual
 * copy/paste into the composer. No automation, no inbox crawling, no
 * private API calls — only what the authenticated user can already
 * see on screen, matching every other adapter's contract.
 *
 * DOM STRATEGY (documented per spec item 2 — avoid fragile CSS
 * classes): Instagram's generated class names churn release to
 * release and are never used here. Signals used instead, weakest to
 * strongest:
 *   - `[role="main"]` — Instagram's own landmark for the thread pane.
 *   - The thread header's first heading/link for the counterpart's
 *     display name + profile link (`/username/`-shaped href).
 *   - `div[role="textbox"][contenteditable="true"]` for the composer
 *     (the same contract every other adapter's inject() uses).
 *   - Message-row geometry (left vs. right alignment inside the
 *     thread pane) for inbound/outbound direction. This is the one
 *     genuinely fragile assumption: Instagram (like every chat UI)
 *     right-aligns the rep's own outbound bubbles and left-aligns the
 *     counterpart's inbound ones, but it exposes no aria-label or
 *     data attribute that says so directly. If Instagram ships a
 *     centered or reversed layout, direction degrades to 'unknown'
 *     rather than guessing — this file is the ONLY place that needs
 *     fixing if that assumption breaks.
 *   - Noise/rich-content classification lives in the DOM-free
 *     `instagramMessageText.ts` module so its rules are unit tested
 *     in isolation and documented there.
 *
 * SPA NAVIGATION: this adapter does not run its own navigation
 * observer. Like every other adapter, it is re-invoked fresh on each
 * SCAN_LEAD_V2 / INJECT_CONTENT_V2 message from the side panel, which
 * always reads `window.location.href` and the live DOM at call time —
 * the existing pull-based pipeline already handles Inbox → thread A →
 * thread B → Inbox → thread C without a second global URL watcher.
 *
 * THREAD-OPEN GATING (mirrors facebook.ts's hasOpenFacebookThread):
 * `hostMatches()`/`detect()` stay broad (any instagram.com/direct/*
 * URL, including the inbox root) so platform identification is always
 * correct. `hasOpenInstagramThread()` is the tighter, exported check
 * that scrapeThread/extractCustomer/extractContext gate on, so
 * "Instagram detected, no conversation selected" reliably returns an
 * empty-but-valid context (message_count 0, customer name null)
 * instead of scraping inbox chrome or throwing.
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
import { classifyInstagramBubble, isInstagramNoiseText } from '../instagramMessageText';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true,
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'social_dm',
  default_output: 'text',
};

const THREAD_PATH_RE = /\/direct\/t\/([^/?#]+)/i;

function hostMatches(url: string): boolean {
  return String(url || '').toLowerCase().includes('instagram.com/direct');
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

/** Thread id from the URL when present ("/direct/t/<id>/"), else a
 *  path-based fallback key so the value is at least stable per-URL. */
function conversationKey(): string {
  try {
    const match = window.location.pathname.match(THREAD_PATH_RE);
    if (match?.[1]) return `t:${match[1]}`;
  } catch {
    /* noop */
  }
  return stableKeyFromPath('ig');
}

/** True only when the URL names a specific thread AND the composer
 *  for it is actually rendered — the same "URL + DOM both agree"
 *  pattern facebook.ts uses to reject the inbox-root / no-selection
 *  case instead of scraping sidebar chrome as if it were a message. */
export function hasOpenInstagramThread(): boolean {
  if (!THREAD_PATH_RE.test(window.location.pathname)) return false;
  try {
    return Boolean(
      document.querySelector('[role="main"] div[role="textbox"][contenteditable="true"]') ||
      document.querySelector('[role="main"] textarea[placeholder]')
    );
  } catch {
    return false;
  }
}

/** Fallback for when Instagram's markup has no `<header>` element at
 *  all (confirmed live 2026-09-23 via DevTools on a real, open 1:1
 *  thread: `document.querySelector('header')` returned null). The
 *  counterpart's display name still renders as an h1/h2 wrapped by
 *  their profile link — just not inside a `<header>` tag. Climbing
 *  from that link, the smallest ancestor containing exactly one
 *  h1/h2 is the counterpart's name; the ancestor picks up a SECOND
 *  heading only once climbing reaches the shared container with the
 *  conversation-list pane (which is headed by the rep's own
 *  username) — so climbing stops the instant a second heading
 *  appears, keeping this a purely structural check that never needs
 *  to know what the rep's own username is. Confirmed against the
 *  real DOM before writing this: the target heading resolved
 *  cleanly from depth 0 through depth 8, and only merged with the
 *  rep's own username heading at depth 9+.
 */
function readHeadingNearProfileLink(): HTMLElement | null {
  try {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;
    const link = main.querySelector('a[role="link"][href^="/"]') as HTMLElement | null;
    if (!link) return null;
    let el: HTMLElement | null = link;
    let candidate: HTMLElement | null = null;
    let depth = 0;
    while (el && depth < 15) {
      const heads = el.querySelectorAll('h1, h2');
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

function readHeaderAnchor(): HTMLElement | null {
  try {
    return (
      (document.querySelector('[role="main"] header h1') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header h2') as HTMLElement | null) ||
      (document.querySelector('[role="main"] header a[role="link"]') as HTMLElement | null) ||
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

/** Profile link + username visible in the thread header, if any.
 *  Instagram profile hrefs are "/username/" — a single path segment,
 *  no known reserved words collide with real handles in the DM
 *  header context, so this is read directly rather than allow-listed. */
function readHeaderProfileLink(): { username: string | null; profile_url: string | null } {
  try {
    const link =
      (document.querySelector('[role="main"] header a[href^="/"]') as HTMLAnchorElement | null) ||
      (document.querySelector('[role="main"] a[role="link"][href^="/"]') as HTMLAnchorElement | null);
    if (!link) return { username: null, profile_url: null };
    const href = link.getAttribute('href') || '';
    const m = href.match(/^\/([A-Za-z0-9._]{1,40})\/?$/);
    if (!m) return { username: null, profile_url: null };
    return {
      username: m[1],
      profile_url: `https://www.instagram.com/${m[1]}/`,
    };
  } catch {
    return { username: null, profile_url: null };
  }
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
  if (!hasOpenInstagramThread()) return emptyThread();

  const messages: ThreadContext['messages'] = [];
  let last_inbound_text = '';
  try {
    const main = document.querySelector('[role="main"]');
    if (main) {
      // Candidate message rows. Instagram groups messages under
      // role="row" in some builds and plain divs with an aria-label
      // containing "Message" in others — both are checked, neither is
      // a generated class name. Kept as a source for media-only
      // bubbles (a photo/video message may carry an aria-label with
      // no dir="auto" text at all).
      const roleCandidates = Array.from(
        main.querySelectorAll('[role="row"], [aria-label*="Message" i], [data-testid*="message" i]')
      );
      // Confirmed live 2026-09-23: on a real, open 1:1 thread, none of
      // the role/aria candidates above actually matched real message
      // text — every match was screen-reader-only announcement text
      // ("React to message from X", "New message"). The real bubble
      // text lives in leaf `div[dir="auto"]` nodes with no nested
      // dir="auto" descendant (confirmed via DevTools: querying these
      // inside [role="main"], excluding the composer's own subtree,
      // returned the actual conversation text). Union both candidate
      // sets rather than replacing the role-based one outright, so
      // this fix doesn't regress whatever media-message handling the
      // role-based selectors were covering.
      const composerBox = main.querySelector('div[role="textbox"][contenteditable="true"]');
      const textLeafCandidates = Array.from(main.querySelectorAll('div[dir="auto"]')).filter((el) => {
        if (composerBox && (el === composerBox || composerBox.contains(el) || el.contains(composerBox))) {
          return false;
        }
        if (!(el.textContent || '').trim()) return false;
        return !el.querySelector('div[dir="auto"]');
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
      const mainRect = (main as HTMLElement).getBoundingClientRect();
      const mid = mainRect.left + mainRect.width / 2;

      for (const b of bubbles) {
        const el = b as HTMLElement;
        const rawText = (el.innerText || '').replace(/\s+/g, ' ').trim();
        const postLink = el.querySelector('a[href*="/p/"], a[href*="/reel/"]') as HTMLAnchorElement | null;
        const hasImage = Boolean(el.querySelector('img'));
        const hasVideo = Boolean(el.querySelector('video'));
        const hasAudio = Boolean(el.querySelector('audio'));
        const hasMediaSignal = Boolean(postLink) || hasImage || hasVideo || hasAudio;
        // A row with NO media signal and noise-only text (presence,
        // receipts, reactions, bare timestamps) is dropped outright.
        // A row WITH a media signal but no caption text still carries
        // real information (the customer sent a photo) and must reach
        // classifyInstagramBubble instead of being treated as noise.
        if (!hasMediaSignal && isInstagramNoiseText(rawText)) continue;

        const classified = classifyInstagramBubble({
          text: rawText,
          hasImage,
          hasVideo,
          hasAudio,
          postHref: postLink?.getAttribute('href') || null,
        });
        if (!classified.text) continue;

        const rect = el.getBoundingClientRect();
        let direction: ThreadContext['messages'][number]['direction'] = 'unknown';
        if (rect.width > 0 && mainRect.width > 0 && rect.width < mainRect.width * 0.9) {
          const center = rect.left + rect.width / 2;
          direction = center > mid ? 'outbound' : 'inbound';
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
  if (!hasOpenInstagramThread()) return { name: null };
  try {
    const { username, profile_url } = readHeaderProfileLink();
    // Direct message header — the counterpart's display name.
    const header = readHeaderText();
    if (header && header.length > 1 && header.length < 60) {
      // Strip trailing IG-specific decorators like "· Active now"
      const cleaned = header.replace(/\s*[·•]\s*(?:Active now|typing|Online|Offline).*$/i, '').trim();
      if (cleaned && cleaned.length > 1) {
        return {
          name: cleaned,
          username,
          profile_url,
          raw_source: 'ig_thread_header',
          confidence: 0.85,
        };
      }
    }
    // Aria-label on the thread — "Chat with <Name>" pattern
    const chatLabel = document.querySelector('[aria-label^="Chat with " i]') as HTMLElement | null;
    if (chatLabel) {
      const label = chatLabel.getAttribute('aria-label') || '';
      const m = label.match(/^Chat with\s+(.+?)(?:\s+profile)?$/i);
      if (m && m[1]) {
        return {
          name: m[1].trim(),
          username,
          profile_url,
          raw_source: 'ig_aria_chat_with',
          confidence: 0.85,
        };
      }
    }
    // No legible display name — still surface username/profile_url if
    // we have them, so generation can at least use the handle instead
    // of guessing (core's isChannelOrUiName gate still runs on name).
    if (username) {
      return {
        name: null,
        username,
        profile_url,
        raw_source: 'ig_header_profile_link_only',
        confidence: 0.4,
      };
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  if (!hasOpenInstagramThread()) {
    return { vehicle: null, vehicle_year: null, vehicle_make: null, vehicle_model: null };
  }
  const body = ((document.querySelector('[role="main"]') as HTMLElement | null)?.innerText || '').slice(0, 4000);
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
    return { ok: false, reason: 'instagram_only_supports_text_inject' };
  }
  // Instagram's compose contenteditable is aria-label="Message" (or a
  // localized equivalent). Falls back to the generic textbox/textarea
  // contract every other adapter shares.
  const box =
    (document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Message" i]') as HTMLElement | null) ||
    (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('textarea[placeholder*="Message" i]') as HTMLElement | null);
  if (!box) return { ok: false, reason: 'no_ig_compose_found' };
  return {
    ok: true,
    method: 'ig_message_composer',
    composer_selector: 'div[role="textbox"][contenteditable="true"]',
  };
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
