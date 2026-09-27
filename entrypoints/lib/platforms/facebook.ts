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
import { isChannelOrUiName, stripConversationWrapper } from '../leadContextScan';
import { extractFacebookTranscript } from '../facebookTranscript';
import { isMessengerSystemCardText } from '../messengerSystemText';
import {
  classifyFacebookSurface,
  isFacebookProfileSurface,
  type FacebookSurface,
  type FacebookSurfaceInfo,
} from './facebookSurface';
import { extractFacebookProspectContext } from './facebookProspectContext';

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
  return hostMatches(window.location.href) && classifyFacebookSurface(window.location.href).supported;
}

function currentFacebookSurface(): FacebookSurfaceInfo {
  const live = classifyFacebookSurface(window.location.href);
  // Unit DOM fixtures run on localhost while exercising Facebook paths.
  // Production always takes the host-validated branch above.
  if (live.surface === 'unsupported' && /^(?:localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    return classifyFacebookSurface(`${window.location.pathname}${window.location.search}`);
  }
  return live;
}

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
  const surface = classifyFacebookSurface(url);
  if (!isFacebookProfileSurface(surface.surface)) return null;
  return surface.profile_id ? `id:${surface.profile_id}` : surface.username;
}

function isFacebookProfilePage(): boolean {
  return isFacebookProfileSurface(currentFacebookSurface().surface);
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

export interface FacebookProfileEvidence {
  source: 'meta_title' | 'page_title' | 'profile_image' | 'profile_link' | 'identity_heading' | 'identity_text';
  value: string;
  weight: number;
}

export interface FacebookProfileSnapshot {
  surface: FacebookSurface;
  status: 'ready' | 'uncertain' | 'unsupported';
  display_name: string | null;
  username: string | null;
  facebook_id: string | null;
  profile_url: string | null;
  profile_bio: string | null;
  confidence: number;
  evidence: FacebookProfileEvidence[];
  route_key: string;
}

const FACEBOOK_PROFILE_UI_TEXT = /^(?:links?|featured|intro|details|personal details|about|overview|work|education|places lived|contact info|basic info|life events|family and relationships|photos?|reels?|videos?|posts?|friends?|followers?|following|all|more|message|messages|follow|following|subscribe|search|notification actions?|here(?:'|’)s how|see more|see all|group posts?|contributions)$/i;

function elementText(element: Element | null): string {
  return String((element as HTMLElement | null)?.innerText || element?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanProfileNameCandidate(value: unknown): string | null {
  const cleaned = stripConversationWrapper(String(value || ''))
    .replace(/^\s*\(\d+\)\s*/, '')
    .replace(/\s*[|–—-]\s*Facebook.*$/i, '')
    .replace(/\s*[·•]\s*(?:Public figure|Digital creator|Artist|Musician|Entrepreneur|Business).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return null;
  if (FACEBOOK_PROFILE_UI_TEXT.test(cleaned) || isChannelOrUiName(cleaned)) return null;
  if (/^(?:\d[\d,.]*\s+)?(?:friends?|followers?|following|posts?|points?)$/i.test(cleaned)) return null;
  if (/^(?:lives in|from|member of|joined|works at|studied at|went to)\b/i.test(cleaned)) return null;
  if (/^(?:http|www\.)|[@#]|\b(?:notifications?|sponsored|advertisement)\b/i.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > 7) return null;
  return cleaned;
}

function isProfileIdentityElement(element: Element): boolean {
  if (element.closest('nav, [role="navigation"], [role="tablist"], [role="tab"], [role="menu"], [role="dialog"], [aria-label*="Sponsored" i]')) return false;
  if (element.getAttribute('aria-hidden') === 'true' || (element as HTMLElement).hidden) return false;
  return true;
}

function hrefMatchesProfile(href: string, surface: FacebookSurfaceInfo): boolean {
  try {
    const target = new URL(href, 'https://www.facebook.com');
    if (surface.profile_id) {
      return target.searchParams.get('id') === surface.profile_id
        || new RegExp(`/(?:user|people)/[^/]*?/?${surface.profile_id}(?:/|$)`, 'i').test(target.pathname);
    }
    if (surface.username) return target.pathname.replace(/^\/+|\/+$/g, '').toLowerCase() === surface.username.toLowerCase();
  } catch {
    return false;
  }
  return false;
}

/**
 * One deterministic profile read shared by the chip and manual scanner.
 * Candidates are collected only from identity-bearing structures; section
 * headings and general page text are never allowed to win by themselves.
 */
export function extractFacebookProfileSnapshot(
  doc: Document = document,
  url: string = window.location.href,
): FacebookProfileSnapshot {
  const requested = classifyFacebookSurface(url);
  const surface = requested.surface === 'unsupported'
    && doc === document
    && /^(?:localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? currentFacebookSurface()
    : requested;
  const base: FacebookProfileSnapshot = {
    surface: surface.surface,
    status: 'unsupported',
    display_name: null,
    username: surface.username,
    facebook_id: surface.profile_id,
    profile_url: surface.canonical_profile_url,
    profile_bio: null,
    confidence: 0,
    evidence: [],
    route_key: surface.route_key,
  };
  if (!isFacebookProfileSurface(surface.surface)) return base;

  const scores = new Map<string, NameScore>();
  const add = (value: unknown, source: FacebookProfileEvidence['source'], weight: number) => {
    const name = cleanProfileNameCandidate(value);
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const item = scores.get(key) || { name, score: 0, evidence: [] };
    item.score += weight;
    item.evidence.push({ source, value: name, weight });
    scores.set(key, item);
  };

  const metaTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content');
  add(metaTitle, 'meta_title', 5);
  add(doc.title, 'page_title', 3);

  for (const element of Array.from(doc.querySelectorAll('img[alt], [aria-label]'))) {
    if (!isProfileIdentityElement(element)) continue;
    const label = element.getAttribute('alt') || element.getAttribute('aria-label') || '';
    const match = label.match(/^(?:Profile (?:picture|photo) of\s+)(.+)$/i)
      || label.match(/^(.+?)(?:'s|’s) profile (?:picture|photo)$/i);
    if (match?.[1]) add(match[1], 'profile_image', 5);
  }

  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    if (!isProfileIdentityElement(anchor)) continue;
    if (hrefMatchesProfile(anchor.getAttribute('href') || '', surface)) add(elementText(anchor), 'profile_link', 4);
  }

  const headings = Array.from(doc.querySelectorAll('h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"]'));
  for (const heading of headings) {
    if (!isProfileIdentityElement(heading)) continue;
    const weight = heading.tagName.toLowerCase() === 'h1' || heading.getAttribute('aria-level') === '1' ? 4 : 3;
    add(elementText(heading), 'identity_heading', weight);
  }

  // Some Facebook experiments render the display name as a plain span/div
  // with large, bold type and NO dir="auto" wrapper. Confirmed live on two
  // independent real profiles (facebook.com/ahormozi, facebook.com/zuck,
  // 2026-09-27): the actual profile-hero name is a leaf <span> at
  // font-size:32px / font-weight:700 with no dir attribute at all, meta
  // og:title absent, no h1 present, and document.title reduced to the
  // generic "Facebook". The old dir="auto"-only selector never matched
  // that element on either profile, so identity extraction fell through
  // to the fragile last-resort bounded-main-text heuristic below on every
  // profile in this render state -- not a selector miss on "some" pages,
  // a miss on the strong signal for ALL of them, leaving success or
  // failure to depend entirely on incidental line ordering in
  // [role="main"]'s text. Matching this confirmed large+bold leaf-text
  // shape directly (independent of the dir attribute) restores a real,
  // specific signal ahead of that fallback. Leaf-only (no element
  // children) keeps this scoped to the name element itself, never a
  // page-wide "first plausible text" scan.
  for (const element of Array.from(doc.querySelectorAll('[dir="auto"], span, div'))) {
    if (element.children.length > 0) continue;
    if (!isProfileIdentityElement(element)) continue;
    let size = 0;
    let weight = 0;
    try {
      const style = doc.defaultView?.getComputedStyle(element);
      size = Number.parseFloat(style?.fontSize || '0');
      weight = Number.parseInt(style?.fontWeight || '0', 10);
    } catch { /* noop */ }
    if (size >= 28 && weight >= 700) add(elementText(element), 'identity_text', 4);
    else if (size >= 20) add(elementText(element), 'identity_text', 2);
  }

  // Classic personal profiles sometimes omit semantic headings altogether.
  // Only inspect the bounded identity block before the profile tab bar.
  const main = doc.querySelector('[role="main"], main') as HTMLElement | null;
  if (main) {
    const lines = String(main.innerText || main.textContent || '')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const tabIndex = lines.findIndex((line) => /^(?:all|about|friends|photos|reels|followers|more)$/i.test(line));
    const identityLines = (tabIndex >= 0 ? lines.slice(0, tabIndex) : lines.slice(0, 12)).slice(0, 12);
    const bounded = identityLines.map(cleanProfileNameCandidate).find(Boolean);
    if (bounded) add(bounded, 'identity_text', 2);
  }

  foldAbsorbedNameCandidates(scores, url);
  const winner = [...scores.values()].sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length)[0];
  if (!winner || winner.score < 2) return { ...base, status: 'uncertain' };
  const confidence = winner.score >= 6 ? 0.92 : winner.score >= 4 ? 0.84 : 0.7;
  const profileRoot = doc.querySelector('[role="main"], main') as HTMLElement | null;
  const profileBio = extractFacebookProspectContext(profileRoot, winner.name);
  return {
    ...base,
    status: 'ready',
    display_name: winner.name,
    profile_bio: profileBio || null,
    confidence,
    evidence: winner.evidence,
  };
}

type NameScore = { name: string; score: number; evidence: FacebookProfileEvidence[] };

/** Evidence that points at the profile's own hero identity, not at a link
 *  or container whose text can pick up neighbouring labels. */
function hasHeroEvidence(item: NameScore): boolean {
  return item.evidence.some((e) => e.source === 'meta_title'
    || e.source === 'page_title'
    || e.source === 'profile_image'
    || e.source === 'identity_heading'
    || (e.source === 'identity_text' && e.weight >= 4));
}

function wordsOf(value: string): string[] {
  return value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * 2026-09-27: a group-member profile produced "Idaho Construction Samantha
 * Daryn Rivera" — a link/container whose text concatenated the group label
 * with the person's name. When one candidate is exactly another hero-backed
 * candidate plus extra leading/trailing words, the extra words are absorbed
 * chrome: fold the longer candidate's score into the visible identity. Only
 * multi-word hero-backed names absorb, so business names like "WSC AUTO
 * Center" are never shortened by an incidental substring.
 */
function foldAbsorbedNameCandidates(scores: Map<string, NameScore>, url: string): void {
  const items = [...scores.entries()];
  for (const [longKey, long] of items) {
    const longWords = wordsOf(long.name);
    let target: NameScore | null = null;
    for (const [shortKey, short] of items) {
      if (shortKey === longKey || !scores.has(shortKey)) continue;
      const shortWords = wordsOf(short.name);
      if (shortWords.length < 2 || shortWords.length >= longWords.length) continue;
      if (!hasHeroEvidence(short)) continue;
      // The profile's own title/photo label is authoritative: never shorten it.
      if (long.evidence.some((e) => e.source === 'meta_title' || e.source === 'profile_image')) continue;
      const isPrefix = shortWords.every((w, i) => longWords[i] === w);
      const isSuffix = shortWords.every((w, i) => longWords[longWords.length - shortWords.length + i] === w);
      if ((isPrefix || isSuffix) && (!target || shortWords.length > wordsOf(target.name).length)) target = short;
    }
    if (target) {
      target.score += long.score;
      target.evidence.push(...long.evidence.map((e) => ({ ...e, value: target!.name })));
      scores.delete(longKey);
    }
  }

  // Group-member route: strip a leading group label that matches the group
  // slug in the URL ("/groups/idahoconstruction/user/123").
  const slug = (() => {
    try {
      const match = new URL(url, 'https://www.facebook.com').pathname.match(/^\/groups\/([^/]+)\/user\//i);
      return match && !/^\d+$/.test(match[1]) ? match[1].toLocaleLowerCase().replace(/[^a-z0-9]/g, '') : '';
    } catch {
      return '';
    }
  })();
  if (!slug) return;
  for (const [key, item] of [...scores.entries()]) {
    const words = item.name.split(/\s+/);
    for (let cut = 1; cut < words.length - 1; cut += 1) {
      const prefix = words.slice(0, cut).join('').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      if (prefix !== slug) continue;
      const stripped = words.slice(cut).join(' ');
      const strippedKey = stripped.toLocaleLowerCase();
      const existing = scores.get(strippedKey);
      scores.delete(key);
      if (existing) {
        existing.score += item.score;
        existing.evidence.push(...item.evidence.map((e) => ({ ...e, value: existing.name })));
      } else {
        scores.set(strippedKey, { name: stripped, score: item.score, evidence: item.evidence.map((e) => ({ ...e, value: stripped })) });
      }
      break;
    }
  }
}

/**
 * Facebook is an SPA: on profile A -> profile B the URL changes before the
 * profile DOM is swapped, so a read in that window sees B's route with A's
 * name and Intro. Remember the last committed identity per route and refuse
 * to attribute that same identity (or its context) to a different route.
 * An uncertain read makes the side panel retry instead of painting A as B.
 */
let lastCommittedProfile: { route_key: string; name: string; bio: string } | null = null;
let routeFirstSeen: { route_key: string; at: number } | null = null;
/** How long a new route may keep showing the previous route's identity
 *  before we accept it as genuinely the same person (e.g. /username and
 *  profile.php?id= for one account). Facebook swaps the DOM well inside this. */
const CARRYOVER_WINDOW_MS = 2500;

export function resetFacebookProfileCarryoverForTests(): void {
  lastCommittedProfile = null;
  routeFirstSeen = null;
}

export function guardFacebookProfileCarryover(snapshot: FacebookProfileSnapshot, now: number = Date.now()): FacebookProfileSnapshot {
  if (routeFirstSeen?.route_key !== snapshot.route_key) routeFirstSeen = { route_key: snapshot.route_key, at: now };
  if (snapshot.status !== 'ready' || !snapshot.display_name) return snapshot;
  const name = snapshot.display_name.toLocaleLowerCase();
  let bio = snapshot.profile_bio || '';
  const prev = lastCommittedProfile;
  if (prev && prev.route_key !== snapshot.route_key) {
    if (prev.name === name && now - routeFirstSeen.at < CARRYOVER_WINDOW_MS) {
      return { ...snapshot, status: 'uncertain', display_name: null, profile_bio: null, confidence: 0 };
    }
    const prevLead = prev.bio.split('\n')[0] || '';
    if (prev.name !== name && bio && (bio === prev.bio || (prevLead.length >= 40 && bio.includes(prevLead)))) bio = '';
  }
  lastCommittedProfile = { route_key: snapshot.route_key, name, bio: snapshot.profile_bio || '' };
  return { ...snapshot, profile_bio: bio || null };
}

function readCurrentFacebookProfile(): FacebookProfileSnapshot {
  return guardFacebookProfileCarryover(extractFacebookProfileSnapshot(document, window.location.href));
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
  const snapshot = readCurrentFacebookProfile();
  const header_text = snapshot.display_name || '';
  const profile_bio = snapshot.profile_bio || '';
  const bodyText = [header_text ? `Profile: ${header_text}` : '', profile_bio ? `About: ${profile_bio}` : '']
    .filter(Boolean)
    .join('\n');
  return {
    conversation_key: snapshot.route_key,
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
    const snapshot = readCurrentFacebookProfile();
    if (snapshot.status === 'ready' && snapshot.display_name) {
      return {
        name: snapshot.display_name,
        username: snapshot.username || undefined,
        profile_url: snapshot.profile_url || undefined,
        raw_source: `fb_profile_${snapshot.surface}`,
        confidence: snapshot.confidence,
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
