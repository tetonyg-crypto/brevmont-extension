/**
 * Facebook Prospect Context — the short "who is this" summary saved with a
 * Facebook profile/page capture.
 *
 * 2026-09-27 regression: the previous scraper kept every line of
 * [role="main"].innerText that wasn't on a small blocklist. On a real profile
 * that region also holds the post composer ("What's on your mind?", "Create a
 * post"), Stories, the whole feed, "People you may know", ads and the footer,
 * so Prospect Context became a page dump (and could carry other people's
 * names and posts). This module is allow-list shaped instead: it only reads
 * the profile header block (between the name and the tab bar) and the Intro
 * card, rejects anything that looks like chrome, counts, buttons, contact
 * rows, timestamps or other people, and caps the result. When nothing clean
 * survives it returns '' — an empty context is always better than a dump.
 */

const MAX_LINES = 5;
const MAX_CHARS = 500;
const MAX_LINE_CHARS = 200;

const TAB_BAR_LINE = /^(?:all|about|friends|photos|reels|videos|more|posts|mentions|reviews|followers|following|check-ins|events|music|groups|live|community|shop)$/i;

/** Headings whose following lines describe the prospect. */
const INFO_SECTION = /^(?:intro|personal details|overview|work|work and education|education|places lived|basic info|details about .+)$/i;

/** Lines that end the Intro card: the next profile section or the feed. */
const SECTION_STOP = /^(?:photos|see all photos|friends|see all friends|featured|posts|create (?:a )?post|what(?:'|’)?s on your mind\??|manage posts|filters|list view|grid view|reels|videos|life events|people you may know|suggested for you|suggested pages|related pages|pages you may like|sponsored|stories|feed|privacy|terms|about|all|mentions|reviews|followers)$/i;

const UI_LINE = /^(?:add friend|friends|message|messages|follow|following|followed|like|liked|likes|share|comment|comments|send|send message|messengersend|messenger|call now|call|book now|contact us|learn more|sign up|shop now|see more|see less|see all|edit|edit details|edit profile|edit bio|add bio|add featured|add to story|add hobbies|details|links|intro|more|manage|search|home|notifications?|menu|marketplace|watch|video|groups|gaming|create|stories|feed|reels?|posts?|photos?|videos?|about|all|everyone|public|only me|friends of friends|live video|photo\/video|feeling\/activity|hide|report|not now|close|options|verified|verified account|profile|page|facebook|meta|intro|overview|work|education|contact info|basic info|places lived|personal details|family and relationships|details about .+|professional dashboard|view as|invite|invite friends|boost post|promote|advertise|insights|get messages|send email|visit website|directions|order food|view shop|join|joined|member|admin|moderator|top fan|rising fan|write a review|recommend|reviews?)$/i;

const UI_ANYWHERE = /(?:what(?:'|’)?s on your mind|create (?:a )?post|people you may know|suggested for you|sponsored|write a (?:comment|public comment|review)|see translation|followed by|mutual friends?|\band \d+ others?\b|\bmembers?\s*[·•]|messengersend|see all friends|see all photos|add to story|\bprivacy\b|\bterms\b|ad choices|\bcookies\b|©|\bmeta\s+20\d\d\b|not yet rated|\breviews?\)|\bis on facebook\b|\bto connect with\b|\blog in\b|\bsign up\b|\bforgot account\b)/i;

const COUNT_LINE = /\b\d[\d.,]*\s*[KMB]?\s+(?:followers?|following|likes?|friends?|talking about this|reviews?|posts?|members?|check-ins?|reactions?|comments?|shares?|views?|people|were here|recommend)\b/i;

const TIMESTAMP_LINE = /^(?:\d+\s*(?:s|m|h|d|w|y|min|mins|hr|hrs|hours?|days?|weeks?|years?)|just now|yesterday|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at\s+.+)?)$/i;

const HOURS_LINE = /^(?:always open|open now|closed now|closes|opens|open 24 hours|hours|temporarily closed|permanently closed|price range\b.*|\$+|\d(?:\.\d)?\s*(?:\(\d[\d,]*\s*reviews?\))?)$/i;

const CONTACT_LINE = /^(?:\+?[\d\s().-]{7,}|[^\s@]+@[^\s@]+\.[^\s@]+|(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i;

const ADDRESS_LINE = /^\d+\s+\S.*\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|ct|court|pl|place|pkwy|parkway|suite|ste)\b\.?(?:,.*)?$|,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;

const DROP_PREFIX = /^(?:joined|member of|member since|followed by|went to|married|in a relationship|single|relationship|born|studied at .+ class of|also known as|pronounces name|view (?:main )?profile|visit profile)\b/i;

const GROUP_CARD_LINE = /(?:(?:'|’)s posts\b|\bposts? in (?:this|the) group\b|\bgroup (?:posts?|contributions|expert|admin|moderator)\b|\bnew member\b|\btop contributor\b)/i;

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value: string): string {
  return value.toLocaleLowerCase();
}

/** Visible text lines of an element in reading order. Uses innerText in the
 *  browser; falls back to leaf-element text where innerText is unavailable
 *  (jsdom unit fixtures). */
export function facebookVisibleLines(root: Element | null): string[] {
  if (!root) return [];
  const inner = (root as HTMLElement).innerText;
  if (typeof inner === 'string' && inner.trim()) {
    return inner.split(/\n+/).map(clean).filter(Boolean);
  }
  const lines: string[] = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.children.length > 0) continue;
    if (element.closest('script, style, noscript')) continue;
    const text = clean(element.textContent);
    if (text) lines.push(text);
  }
  return lines;
}

/** Normalize one candidate line; returns '' when it is chrome or noise. */
export function cleanFacebookProspectLine(value: unknown, name: string): string {
  let line = clean(value);
  if (!line) return '';
  // "Page · Automotive Repair Shop" / "Profile · Digital creator" → category.
  const category = line.match(/^(?:page|profile|public figure|creator)\s*[·•]\s*(.+)$/i);
  if (category) line = clean(category[1]);
  // Facebook truncates long bios with a trailing "See more".
  line = line.replace(/\s*(?:…|\.\.\.)?\s*see more$/i, '').trim();
  if (line.length < 3 || line.length > MAX_LINE_CHARS) return '';
  if (!/\p{L}{2,}/u.test(line)) return '';
  const nameLower = lower(clean(name));
  const lineLower = lower(line);
  if (nameLower && (lineLower === nameLower || lineLower.replace(/\s+/g, '') === nameLower.replace(/\s+/g, '').repeat(2))) return '';
  if ((line.match(/facebook/gi) || []).length >= 2) return '';
  if (UI_LINE.test(line) || TAB_BAR_LINE.test(line) || SECTION_STOP.test(line)) return '';
  if (UI_ANYWHERE.test(line)) return '';
  if (COUNT_LINE.test(line) || /^[\d.,]+\s*[KMB]?$/i.test(line)) return '';
  if (TIMESTAMP_LINE.test(line) || HOURS_LINE.test(line) || CONTACT_LINE.test(line)) return '';
  if (DROP_PREFIX.test(line) || GROUP_CARD_LINE.test(line) || ADDRESS_LINE.test(line)) return '';
  // Lines that are mostly separators/counts ("1.2K · 300") or a name list.
  if (/[·•]/.test(line) && line.split(/\s*[·•]\s*/).some((part) => COUNT_LINE.test(part) || /^[\d.,]+\s*[KMB]?$/i.test(part))) return '';
  return line;
}

function finish(lines: string[]): string {
  const kept: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const key = lower(line);
    if (kept.some((existing) => lower(existing) === key || lower(existing).includes(key) || key.includes(lower(existing)))) continue;
    kept.push(line);
    if (kept.length >= MAX_LINES) break;
  }
  return kept.join('\n').slice(0, MAX_CHARS).trim();
}

/**
 * Extract a short prospect summary from the visible lines of a Facebook
 * profile/page. Reads only (1) the header block between the display name and
 * the tab bar and (2) the Intro card. Never reads the feed, the composer,
 * suggestions, or the footer. Returns '' when nothing trustworthy remains.
 */
export function extractFacebookProspectContextFromLines(lines: string[], name: string): string {
  const all = lines.map(clean).filter(Boolean);
  const nameLower = lower(clean(name));
  const header: string[] = [];
  const intro: string[] = [];

  // (1) Header block: lines immediately after the name, before the tab bar.
  const nameIndex = nameLower ? all.findIndex((line) => lower(line) === nameLower) : -1;
  if (nameIndex >= 0) {
    const after = all.slice(nameIndex + 1);
    const tabIndex = after.findIndex((line) => TAB_BAR_LINE.test(line) || SECTION_STOP.test(line));
    for (const line of (tabIndex >= 0 ? after.slice(0, tabIndex) : after.slice(0, 4)).slice(0, 6)) {
      const kept = cleanFacebookProspectLine(line, name);
      // Header lines are short labels (category/occupation), never prose.
      if (kept && kept.length <= 80) header.push(kept);
    }
  }

  // (2) Intro card and About-tab detail sections: read each section from its
  // heading to the next section/feed marker. A post author line (the name
  // again), a timestamp or a group-card label also ends the section.
  let remaining = 0;
  for (let index = Math.max(nameIndex + 1, 0); index < all.length; index += 1) {
    const line = all[index];
    if (INFO_SECTION.test(line)) {
      remaining = 8;
      continue;
    }
    if (remaining <= 0) continue;
    if (SECTION_STOP.test(line) || lower(line) === nameLower || TIMESTAMP_LINE.test(line) || GROUP_CARD_LINE.test(line)) {
      remaining = 0;
      continue;
    }
    remaining -= 1;
    const kept = cleanFacebookProspectLine(line, name);
    if (kept) intro.push(kept);
  }

  // Intro content first (bio/description), then header labels (category).
  return finish([...intro, ...header]);
}

/** DOM entry point used by the Facebook adapter. */
export function extractFacebookProspectContext(root: Element | null, name: string): string {
  return extractFacebookProspectContextFromLines(facebookVisibleLines(root), name);
}

/**
 * Display-time guard for Facebook prospect context that was produced by an
 * older build (or echoed back by the server): re-applies the same line filter
 * and caps. Anything that looks like a page dump collapses to ''.
 */
export function sanitizeFacebookProspectContext(value: unknown, name: string): string {
  const text = String(value || '').replace(/^About:\s*/i, '');
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  if (!lines.length) return '';
  // A stored context with this many lines was a page dump; do not try to
  // salvage fragments of other people's posts out of it.
  if (lines.length > 12) return '';
  return finish(lines.map((line) => cleanFacebookProspectLine(line, name)));
}
