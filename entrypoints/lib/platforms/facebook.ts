/**
 * Facebook adapter — handles Marketplace + Messenger + facebook.com/messages.
 *
 * This is the flagship surface. The existing inline branches in
 * content.ts SCAN_LEAD (isFacebook) + injectContent + the Overdrive
 * scrapeActiveThread all consolidate here. The Overdrive controller
 * still uses its own contentBridge for detection signals — this
 * adapter provides the manual-scan + manual-inject path.
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
import { extractVehicleHint } from './shared';
import { stripConversationWrapper } from '../leadContextScan';
import { extractFacebookTranscript } from '../facebookTranscript';
import { isMessengerSystemCardText } from '../messengerSystemText';

const CAPS: AdapterCapabilities = {
  supports_inject_text: true,
  supports_inject_email: false,
  supports_inject_crm_note: false,
  supports_thread_history: true,
  supports_customer_extraction: true,
  surface_kind: 'social_dm',
  default_output: 'text',
};

function hostMatches(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('messenger.com') ||
    u.includes('facebook.com/messages') ||
    u.includes('facebook.com/marketplace/t/') ||
    u.includes('facebook.com')
  );
}

function detect(): boolean {
  return hostMatches(window.location.href);
}

// Facebook's own reserved top-level routes -- excluded so a profile/page
// username is never mistaken among them. Longer than Instagram/X's lists
// because Facebook has far more first-class surfaces at the bare root.
const FB_RESERVED_PATHS = new Set([
  'messages', 'marketplace', 'groups', 'pages', 'watch', 'gaming', 'events',
  'friends', 'notifications', 'settings', 'help', 'ads', 'business',
  'bookmarks', 'stories', 'reel', 'reels', 'live', 'jobs', 'dating',
  'weather', 'games', 'offers', 'saved', 'memories', 'hashtag', 'photo',
  'photos', 'video', 'videos', 'login', 'recover', 'policies', 'about',
  'legal', 'privacy', 'terms', 'campaign', 'plugins', 'sharer', 'dialog',
  'tr', 'l.php', 'profile.php', 'checkpoint', 'mbasic', 'gaming', 'ads_manager',
  'permalink.php', 'story.php', 'search', 'find-friends', 'allactivity',
]);

/**
 * Profile identifier for a Facebook profile/business page (not Messenger,
 * not Marketplace). Handles both the vanity-username route
 * ("facebook.com/jflores.carguy/") and the numeric-id route
 * ("facebook.com/profile.php?id=100012345") since Facebook still serves
 * both styles for real accounts. Added 2026-09-26 after a live confirmed
 * failure: "+Lead > Scan This Page" on a real profile returned "Couldn't
 * read this page" because extractCustomer/scrapeThread both unconditionally
 * gated on hasOpenFacebookThread(), which a profile page (no Messenger/
 * Marketplace thread key) always fails.
 */
export function facebookProfileIdFromUrl(url: string): string | null {
  try {
    const u = String(url || '');
    const parsed = u.includes('://') ? new URL(u) : new URL(u, 'https://www.facebook.com');
    if (parsed.pathname.toLowerCase() === '/profile.php') {
      const id = parsed.searchParams.get('id');
      return id ? `id:${id}` : null;
    }
    const m = parsed.pathname.match(/^\/([A-Za-z0-9.]{1,60})\/?(?:[?#]|$)/);
    if (!m) return null;
    const seg = m[1];
    if (FB_RESERVED_PATHS.has(seg.toLowerCase())) return null;
    return seg;
  } catch {
    return null;
  }
}

function isFacebookProfilePage(): boolean {
  return !hasOpenFacebookThread() && !!facebookProfileIdFromUrl(window.location.href);
}

function conversationKey(): string {
  try {
    const path = window.location.pathname;
    const mp = path.match(/\/marketplace\/t\/([^/?#]+)/);
    if (mp) return `mp:${mp[1]}`;
    const t = path.match(/\/t\/([^/?#]+)/);
    if (t) return `t:${t[1]}`;
    const m = path.match(/\/messages\/t\/([^/?#]+)/);
    if (m) return `t:${m[1]}`;
    return `path:${path}`;
  } catch {
    return `unknown:${Date.now()}`;
  }
}

/** True only when a real Messenger / Marketplace thread pane is open. */
export function hasOpenFacebookThread(): boolean {
  const key = conversationKey();
  if (!key.startsWith('t:') && !key.startsWith('mp:')) return false;
  try {
    return Boolean(document.querySelector('div[role="textbox"][contenteditable="true"]'));
  } catch {
    return false;
  }
}

function readHeaderText(): string {
  try {
    // 2026-09-26 regression: on a Facebook PROFILE page, the nav tab bar
    // (All / About / Friends / Photos / Reels / More) sits directly below
    // the name heading -- when the primary selector missed the actual
    // name element, the fallback chain picked up a tab label instead
    // ("This for Reels?", confirmed live). Skip anything inside the tab
    // bar itself so a missed name selector fails closed (empty), not with
    // a plausible-looking piece of nav chrome.
    const isNavChrome = (el: Element | null): boolean => !!el?.closest('[role="tablist"], [role="tab"]');
    const candidates = [
      ...Array.from(document.querySelectorAll('[role="main"] h1')),
      ...Array.from(document.querySelectorAll('[role="main"] h2')),
      ...Array.from(document.querySelectorAll('[role="main"] header')),
      ...Array.from(document.querySelectorAll('[role="main"] strong')),
    ] as HTMLElement[];
    const isUiLabel = (value: string): boolean => /^(?:personal details|overview|contact info|places lived|work|education|posts?|photos?|reels?|friends?|about|all|more|message|see all friends|inside car guys)$/i.test(value)
      || /^(?:\d[\d,.]*\s+)?(?:friends?|followers?|following|posts?)$/i.test(value)
      || /^(?:lives in|from|male|female|english language|general manager)\b/i.test(value);
    const clean = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();
    const anchor = candidates
      .filter((el) => !isNavChrome(el))
      .map((el) => clean(el.innerText))
      .find((value) => value.length > 1 && value.length < 80 && !isUiLabel(value));
    if (anchor) return anchor.slice(0, 200);

    // Some Facebook profile builds render the name as an unlabelled div and
    // omit h1/h2 entirely. In that case the first meaningful line in the
    // profile header precedes the nav tabs; never let a lower About-section
    // heading become the customer name.
    const main = document.querySelector('[role="main"]') as HTMLElement | null;
    const lines = String(main?.innerText || '')
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
    const navIndex = lines.findIndex((line) => /^(?:all|about|friends|photos|reels|more)$/i.test(line));
    const headerLines = navIndex >= 0 ? lines.slice(0, navIndex) : lines.slice(0, 20);
    return headerLines.find((line) => line.length > 1 && line.length < 80 && !isUiLabel(line) && !/^\d[\d,.]*$/.test(line))?.slice(0, 200) || '';
  } catch {
    return '';
  }
}

/** Keep useful About/profile details without saving Facebook's navigation,
 *  repeated section titles, or the entire rendered page as lead context. */
function scrapeFacebookProfileBio(main: HTMLElement | null, name: string): string {
  const blocked = /^(?:all|about|friends|photos|reels|more|message|posts?|personal details|overview|contact info|places lived|work|education|see all friends|see all photos|inside car guys)$/i;
  const lines = String(main?.innerText || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    if (line.toLowerCase() === name.toLowerCase()) continue;
    if (blocked.test(line) || /^\d[\d,.]*\s+friends?$/i.test(line)) continue;
    if (/^(?:home|search|notifications|marketplace|watch|groups|gaming|create|follow|add friend|open profile|view profile)$/i.test(line)) continue;
    if (/^see all friends$/i.test(line)) break;
    if (kept[kept.length - 1] === line) continue;
    kept.push(line);
  }
  return kept.join('\n').slice(0, 1800);
}

/**
 * Facebook PROFILE/business page (not a Messenger/Marketplace thread).
 * Same discipline as Instagram/X's profile branches: no ID guessing --
 * the identifier comes from the URL itself -- and the "Personal
 * details"/"Work"/"About" block is read as one bounded blob of visible
 * text rather than parsed field-by-field, so a markup change can only
 * shrink what's captured, never misattribute one field's text to another.
 */
function scrapeFacebookProfile(): ThreadContext {
  const profileId = facebookProfileIdFromUrl(window.location.href) || '';
  const main = document.querySelector('[role="main"]') as HTMLElement | null;
  const nameHeading = readHeaderText();
  const header_text = nameHeading || (profileId.startsWith('id:') ? '' : profileId);
  const profile_bio = scrapeFacebookProfileBio(main, nameHeading);
  const bodyText = [header_text ? `Profile: ${header_text}` : '', profile_bio ? `About: ${profile_bio}` : '']
    .filter(Boolean)
    .join('\n');
  return {
    conversation_key: `fb_profile:${profileId || 'unknown'}`,
    raw_text: bodyText,
    messages: [],
    last_inbound_text: '',
    header_text: header_text.slice(0, 200),
    profile_bio: profile_bio || null,
    url: window.location.href,
    scanned_at: Date.now(),
    message_count: 0,
    listing: { title: null, sold: false },
  };
}

function scrapeThread(): ThreadContext {
  if (isFacebookProfilePage()) return scrapeFacebookProfile();
  if (!hasOpenFacebookThread()) {
    return {
      conversation_key: conversationKey(),
      raw_text: '',
      messages: [],
      last_inbound_text: '',
      header_text: '',
      url: window.location.href,
      scanned_at: Date.now(),
      message_count: 0,
      listing: { title: null, sold: false },
    };
  }
  const transcript = extractFacebookTranscript(document);
  const header = readHeaderText();
  const context = extractContext();
  const rawLines: string[] = [];
  for (const text of [transcript.raw_text].filter(Boolean).join('\n').split(/\n+/)) {
    if (isMessengerSystemCardText(text)) continue;
    rawLines.push(text);
  }
  const raw_text = rawLines.join('\n').slice(0, 5000);
  return {
    conversation_key: conversationKey(),
    raw_text,
    messages: transcript.messages.slice(-25),
    last_inbound_text: transcript.last_inbound_text,
    header_text: header,
    url: window.location.href,
    scanned_at: transcript.scanned_at,
    last_inbound_hash: transcript.last_inbound_hash,
    message_count: transcript.message_count,
    listing: {
      title: context.listing_title || context.vehicle || header || null,
      sold: /\bsold\b/i.test(header || ''),
    },
  };
}

function extractCustomer(): CustomerCandidate {
  if (isFacebookProfilePage()) {
    const profileId = facebookProfileIdFromUrl(window.location.href) || '';
    const name = readHeaderText();
    const cleaned = stripConversationWrapper(name).trim();
    if (cleaned && cleaned.length > 1 && cleaned.length < 80 && !/^id:/.test(cleaned)) {
      return {
        name: cleaned,
        username: profileId.startsWith('id:') ? undefined : profileId || undefined,
        profile_url: profileId && !profileId.startsWith('id:') ? `https://www.facebook.com/${profileId}` : undefined,
        raw_source: 'fb_profile_heading',
        confidence: 0.7,
      };
    }
    return { name: null };
  }
  if (!hasOpenFacebookThread()) return { name: null };
  // Priority order:
  //   1. aria-label paths (Conversation with X, Conversation titled X,
  //      Chat with X, Message X, Profile picture of X)
  //   2. "<Buyer> · <listing>" Marketplace splitter
  //   3. header spans (with "Conversation titled" prefix stripping so
  //      Facebook accounts without a friendly display name still yield
  //      the raw handle instead of the UI label)
  // All raw candidates are returned to the core, which runs
  // pickCleanName across them (isChannelOrUiName gate). Belt-and-
  // suspenders: this function ALSO strips known UI prefixes so the
  // core doesn't reject a real name that happens to be prefixed.
  //
  // 2026-07-03 regression: for Cardog (a real Marketplace buyer whose
  // FB account has no friendly display name), the aria-label was
  // "Conversation titled Cardog" — the original pattern only matched
  // "Conversation with X" so it fell through to marketplace_header_split
  // which returned the raw h1 "Conversation titled Cardog", and the
  // core's channel/UI-name gate didn't recognize that pattern. Fixed
  // by (a) adding "titled" to the strip regex, (b) adding regex catches
  // in leadContextScan.ts for the raw string.
  const stripUiPrefix = (label: string): string => stripConversationWrapper(label)
    .replace(/\s+(?:profile|conversation)$/i, '')
    .trim();

  try {
    const labelled = Array.from(document.querySelectorAll('[aria-label]'))
      .map((el) => el.getAttribute('aria-label') || '')
      .find((label) => /^(?:Message|Conversation\s+\w+|Chat\s+with|Profile\s+picture\s+of|Open\s+profile\s+for)\s+\S+/i.test(label));
    if (labelled) {
      const cleaned = stripUiPrefix(labelled);
      if (cleaned && cleaned.length > 1 && cleaned.length < 60) {
        return { name: cleaned, raw_source: 'aria_label_conversation_with', confidence: 0.9 };
      }
    }

    // Marketplace "<Buyer> · <Listing>" splitter — also strips the UI
    // prefix in case the h1 itself is prefixed.
    const header = document.querySelector('[role="main"] h1, [role="main"] h2') as HTMLElement | null;
    if (header) {
      const raw = (header.innerText || header.textContent || '').trim();
      const firstSegment = raw.split(/\s*[·•\-]\s*/)[0]?.trim();
      if (firstSegment && firstSegment.length > 1 && firstSegment.length < 60) {
        const stripped = stripUiPrefix(firstSegment);
        // If stripping produced a meaningful name, use it. If stripping
        // produced nothing (the h1 was JUST "Conversation titled" with
        // nothing after — shouldn't happen but defensive), return the
        // raw firstSegment so the core's gate can reject it uniformly.
        const chosen = stripped && stripped.length > 1 ? stripped : firstSegment;
        return { name: chosen, raw_source: 'marketplace_header_split', confidence: 0.75 };
      }
    }

    // Last resort — messenger.com tab title without unread-count prefix
    if (window.location.hostname.includes('messenger.com')) {
      const t = (document.title || '')
        .replace(/^\s*\(\d+\)\s*/, '')
        .replace(/\s*[|-].*(?:Messenger|Facebook).*$/i, '')
        .trim();
      if (t && t.length > 1 && t.length < 50) {
        return { name: t, raw_source: 'messenger_title', confidence: 0.55 };
      }
    }
  } catch {
    /* noop */
  }
  return { name: null };
}

function extractContext(): DealContext {
  if (!hasOpenFacebookThread()) {
    return {
      vehicle: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      listing_title: null,
      listing_url: window.location.href,
    };
  }
  const header = readHeaderText();
  const vh = extractVehicleHint(header) || extractVehicleHint((document.querySelector('[role="main"]') as HTMLElement | null)?.innerText || '');
  // Marketplace: header is "Buyer · Listing Title" — grab the second half.
  let listing_title: string | null = null;
  if (header.includes('·') || header.includes('•')) {
    listing_title = header.split(/\s*[·•]\s*/)[1]?.trim() || null;
  } else if (/(?:19|20)\d{2}\s+[A-Z]/.test(header)) {
    listing_title = header;
  }
  return {
    vehicle: vh?.raw || null,
    vehicle_year: vh?.year || null,
    vehicle_make: vh?.make || null,
    vehicle_model: vh?.model || null,
    listing_title,
    listing_url: window.location.href,
  };
}

async function inject(text: string, kind: InjectKind): Promise<InjectResult> {
  if (kind !== 'text') {
    return { ok: false, reason: 'facebook_only_supports_customer_message_inject' };
  }
  // Facebook composer selector chain. Uses the same DOM contract
  // safeInjectText targets. The actual DOM write happens in content.ts
  // via the OVERDRIVE_INJECT_TEXT / INJECT_CONTENT handler, which
  // this adapter delegates to. Because safeInjectText lives inside
  // the content-script closure, the adapter's role is to (a) find
  // the composer and (b) hand the text to the shared write path.
  //
  // The content-script message handler dispatches to this adapter,
  // so the composer resolution + safeInjectText call happens in the
  // same scope. Here we just describe what the adapter would use —
  // the actual write is the shared `writeToComposer` helper the core
  // injects.
  const composer = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null;
  if (!composer) {
    return { ok: false, reason: 'composer_not_found', composer_selector: 'div[role="textbox"][contenteditable="true"]' };
  }
  // The actual safeInjectText call is done by the message handler in
  // content.ts using the shared write function. This adapter method
  // returns "ok: true, composer_found" and the core takes it from
  // there — this keeps safeInjectText's closure scope untouched.
  return { ok: true, method: 'facebook_composer', composer_selector: 'div[role="textbox"][contenteditable="true"]' };
}

export const facebookAdapter: PlatformAdapter = {
  id: 'facebook',
  capabilities: CAPS,
  hostMatches,
  detect,
  scrapeThread,
  extractCustomer,
  extractContext,
  inject,
};
