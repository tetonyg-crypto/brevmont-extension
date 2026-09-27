/**
 * Facebook Prospect Context — the short "who is this" summary saved with a
 * Facebook profile/page capture.
 *
 * History:
 * - 2026-09-27 (am): the original scraper kept every line of
 *   [role="main"].innerText that wasn't on a small blocklist, so the post
 *   composer, Stories, the feed, "People you may know", ads and the footer all
 *   became Prospect Context.
 * - 2026-09-27 (pm): the allow-list replacement was too conservative for the
 *   live 2026 layout. Evidence from real profiles (hridoyreh, zuck,
 *   grupofuerzalegal, fixitrightboise): there is no "Intro" heading any more;
 *   the bio, category, location and workplace sit in the profile HEADER block
 *   (between the name and the tab bar), and contact data sits under "Details",
 *   "Contact info" and "Links" headings. The old filter capped header lines at
 *   80 chars (dropping real bios) and rejected every phone/email/website row.
 *
 * Architecture: read ONLY targeted regions (header block + named profile
 * sections), classify each line into a structured field (bio, label, website,
 * phone, email, social handle), run text fields through the pollution
 * sanitizer, then assemble one concise string. The feed, composer,
 * suggestions, Featured posts, communities and footer are never read. When
 * nothing validated survives the result is '' (the lead card then says there
 * is no public bio). Never inferred, never OCR'd, never broadened.
 */

const MAX_CHARS = 700;
const MAX_LINE_CHARS = 300;
const MAX_BIO_CHARS = 280;

const TAB_BAR_LINE = /^(?:all|about|friends|photos|reels|videos|more|posts|mentions|reviews|followers|following|check-ins|events|music|groups|live|community|shop)$/i;

/** Profile-owned sections whose lines describe the prospect. */
const INFO_SECTION = /^(?:intro|details|contact info|contact and basic info|links|websites and social links|personal details|overview|work|work and education|education|places lived|basic info|category|details about .+)$/i;

/** Lines that end a section: the next non-profile region or the feed. */
const SECTION_STOP = /^(?:photos|see all photos|friends|see all friends|featured|posts|create (?:a )?post|what(?:'|’)?s on your mind\??|manage posts|filters|list view|grid view|reels|videos|life events|people you may know|suggested for you|suggested pages|related pages|pages you may like|sponsored|stories|feed|privacy|terms|about|all|mentions|reviews|followers|following|communities|groups|highlights|music|check-ins|events|no posts available|recent activity|group posts|pinned post)$/i;

const UI_LINE = /^(?:add friend|friends|message|messages|follow|following|followed|like|liked|likes|share|comment|comments|send|send message|messengersend|messenger|call now|call|book now|contact us|learn more|sign up|shop now|see more|see less|see all|edit|edit details|edit profile|edit bio|add bio|add featured|add to story|add hobbies|details|links|intro|more|manage|search|home|notifications?|menu|marketplace|watch|video|groups|gaming|create|stories|feed|reels?|posts?|photos?|videos?|about|all|everyone|public|only me|friends of friends|live video|photo\/video|feeling\/activity|hide|report|not now|close|options|verified|verified account|profile|page|facebook|intro|overview|work|education|contact info|basic info|places lived|personal details|family and relationships|details about .+|professional dashboard|view as|invite|invite friends|boost post|promote|advertise|insights|get messages|send email|visit website|directions|order food|view shop|join|joined|member|admin|moderator|top fan|rising fan|write a review|recommend|reviews?|communities|featured|filters)$/i;

const UI_ANYWHERE = /(?:what(?:'|’)?s on your mind|create (?:a )?post|people you may know|suggested for you|sponsored|write a (?:comment|public comment|review)|see translation|followed by|mutual friends?|\band \d+ others?\b|\bmembers?\s*[·•]|messengersend|see all friends|see all photos|add to story|\bprivacy\b|\bterms\b|ad choices|\bcookies\b|©|\bmeta\s+20\d\d\b|not yet rated|\breviews?\)|\bis on facebook\b|\bto connect with\b|\blog in\b|\bforgot account\b|\bcomment as\b|\bupdated (?:his|her|their) (?:cover|profile) photo\b|\bshared a (?:post|memory|reel)\b|\bmay be an image of\b)/i;

const COUNT_LINE = /\b\d[\d.,]*\s*[KMB]?\s+(?:followers?|following|likes?|friends?|talking about this|reviews?|posts?|members?|check-ins?|reactions?|comments?|shares?|views?|people|were here|recommend|points?)\b/i;

const TIMESTAMP_LINE = /^(?:\d+\s*(?:s|m|h|d|w|y|min|mins|hr|hrs|hours?|days?|weeks?|years?)|just now|yesterday|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at\s+.+)?)$/i;

const HOURS_LINE = /^(?:always open|open now|closed now|closes|opens|open 24 hours|hours|temporarily closed|permanently closed|price range\b.*|\$+|\d(?:\.\d)?\s*(?:\(\d[\d,]*\s*reviews?\))?|\d+% recommend.*)$/i;

const STREET_ADDRESS_LINE = /^\d+\s+\S.*\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|ct|court|pl|place|pkwy|parkway|suite|ste)\b/i;

const DROP_PREFIX = /^(?:joined|member since|followed by|went to|married|in a relationship|single|relationship|born|studied at .+ class of|also known as|pronounces name|view (?:main )?profile|visit profile|see (?:more|all)\b)/i;

const GROUP_CARD_LINE = /(?:(?:'|’)s posts\b|\bposts? in (?:this|the) group\b|\bgroup (?:posts?|contributions|expert|admin|moderator)\b|\bnew member\b|\btop contributor\b|(?:'|’)s contributions\b)/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
const URL_OR_DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i;
const HANDLE_RE = /^@[A-Za-z0-9._]{2,30}$/;
const BARE_HANDLE_RE = /^[A-Za-z0-9._]{3,30}$/;
const SOCIAL_HOSTS = /^(?:instagram\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|threads\.net|linkedin\.com|snapchat\.com|pinterest\.com)$/i;
const FACEBOOK_HOSTS = /(?:^|\.)(?:facebook\.com|fb\.me|fb\.com|messenger\.com|m\.me)$/i;

type Region = 'header' | 'intro' | 'section' | 'links';

type Field =
  | { kind: 'bio' | 'label'; value: string }
  | { kind: 'website' | 'phone' | 'email' | 'social'; value: string };

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

/** True when a text fragment is Facebook chrome, feed, counts or noise. */
function isPolluted(line: string, name: string): boolean {
  if (!line || !/\p{L}{2,}/u.test(line)) return true;
  const lineLower = lower(line);
  const nameLower = lower(clean(name));
  if (nameLower && (lineLower === nameLower || lineLower.replace(/\s+/g, '') === nameLower.replace(/\s+/g, '').repeat(2))) return true;
  if ((line.match(/facebook/gi) || []).length >= 2) return true;
  if (UI_LINE.test(line) || TAB_BAR_LINE.test(line) || SECTION_STOP.test(line)) return true;
  if (UI_ANYWHERE.test(line)) return true;
  // Counts are chrome in short rows ("7K followers • 33 following"); a real
  // bio can mention "500 people" without being a counter.
  if (line.length <= 60 && (COUNT_LINE.test(line) || /^[\d.,]+\s*[KMB]?$/i.test(line))) return true;
  if (TIMESTAMP_LINE.test(line) || HOURS_LINE.test(line)) return true;
  if (DROP_PREFIX.test(line) || GROUP_CARD_LINE.test(line) || STREET_ADDRESS_LINE.test(line)) return true;
  if (/[·•]/.test(line) && line.split(/\s*[·•]\s*/).some((part) => COUNT_LINE.test(part) || /^[\d.,]+\s*[KMB]?$/i.test(part))) return true;
  return false;
}

/** Normalize one candidate text line; returns '' when it is chrome or noise. */
export function cleanFacebookProspectLine(value: unknown, name: string): string {
  let line = clean(value);
  if (!line) return '';
  // "Page · Automotive Repair Shop" / "Profile · Digital creator" → category.
  const category = line.match(/^(?:page|profile|public figure|creator)\s*[·•]\s*(.+)$/i);
  if (category) line = clean(category[1]);
  // Facebook truncates long bios with a trailing "See more" / ellipsis.
  line = line.replace(/\s*(?:…|\.\.\.)?\s*see more$/i, '').replace(/\s*(?:…|\.\.\.)$/, '').trim();
  if (line.length < 3 || line.length > MAX_LINE_CHARS) return '';
  return isPolluted(line, name) ? '' : line;
}

function normalizeWebsite(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/** Classify one line from a targeted profile region into a structured field. */
function classifyLine(raw: string, name: string, region: Region): Field | null {
  const line = clean(raw);
  if (!line) return null;

  if (EMAIL_RE.test(line)) return { kind: 'email', value: line.toLowerCase() };
  if (PHONE_RE.test(line)) {
    const digits = line.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? { kind: 'phone', value: line } : null;
  }
  if (URL_OR_DOMAIN_RE.test(line)) {
    const site = normalizeWebsite(line);
    const host = site.split('/')[0].toLowerCase();
    if (FACEBOOK_HOSTS.test(host)) return null;
    if (SOCIAL_HOSTS.test(host)) {
      const handle = site.split('/').filter(Boolean)[1]?.replace(/^@/, '');
      return handle && /^[A-Za-z0-9._-]{2,40}$/.test(handle) ? { kind: 'social', value: `@${handle}` } : null;
    }
    return { kind: 'website', value: site };
  }
  if (HANDLE_RE.test(line)) return { kind: 'social', value: line };
  // The Links card shows social profiles as a bare handle next to an icon.
  if (region === 'links' && BARE_HANDLE_RE.test(line) && !UI_LINE.test(line) && lower(line) !== lower(clean(name))) {
    return { kind: 'social', value: `@${line}` };
  }

  // Group-membership rows are chrome on a group-member card, but an Intro
  // row "Member of <group>" is the prospect's own public profile field.
  if (/^member of\b/i.test(line) && region !== 'intro') return null;

  const text = cleanFacebookProspectLine(line, name);
  if (!text) return null;
  const isProse = text.length > 60 || (/[.!?]/.test(text) && text.split(/\s+/).length > 6);
  return { kind: isProse ? 'bio' : 'label', value: text };
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function truncateBio(value: string): string {
  if (value.length <= MAX_BIO_CHARS) return value;
  const cut = value.slice(0, MAX_BIO_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).trim()}…`;
}

/** Assemble validated fields into one concise Prospect Context string. */
function assemble(fields: Field[]): string {
  const bios: string[] = [];
  const labels: string[] = [];
  const websites: string[] = [];
  const phones: string[] = [];
  const emails: string[] = [];
  const socials: string[] = [];
  const seenDigits = new Set<string>();
  for (const field of fields) {
    const key = lower(field.value);
    if (field.kind === 'bio') {
      if (bios.length < 2 && !bios.some((b) => lower(b).includes(key) || key.includes(lower(b)))) bios.push(truncateBio(field.value));
    } else if (field.kind === 'label') {
      if (labels.length < 6 && !labels.some((l) => lower(l) === key)) labels.push(field.value);
    } else if (field.kind === 'website') {
      if (websites.length < 2 && !websites.some((w) => lower(w) === key)) websites.push(field.value);
    } else if (field.kind === 'phone') {
      const digits = field.value.replace(/\D/g, '');
      if (phones.length < 2 && !seenDigits.has(digits)) { seenDigits.add(digits); phones.push(field.value); }
    } else if (field.kind === 'email') {
      if (emails.length < 2 && !emails.includes(key)) emails.push(key);
    } else if (field.kind === 'social') {
      if (socials.length < 4 && !socials.some((s) => lower(s) === key)) socials.push(field.value);
    }
  }

  const prose = bios.join(' ');
  const inProse = (value: string) => lower(prose).includes(lower(value));
  const digitsInProse = prose.replace(/\D/g, '');
  const parts: string[] = [];
  for (const bio of bios) parts.push(ensureSentence(bio));
  for (const label of labels) if (!inProse(label)) parts.push(ensureSentence(label));
  const sites = websites.filter((w) => !inProse(w));
  if (sites.length) parts.push(`Website: ${sites.join(' / ')}.`);
  const phoneList = phones.filter((p) => !digitsInProse.includes(p.replace(/\D/g, '')));
  if (phoneList.length) parts.push(`Phone: ${phoneList.join(' / ')}.`);
  const emailList = emails.filter((e) => !inProse(e));
  if (emailList.length) parts.push(`Email: ${emailList.join(' / ')}.`);
  const socialList = socials.filter((s) => !inProse(s) && !inProse(s.replace(/^@/, '')));
  if (socialList.length) parts.push(`Social: ${socialList.join(' / ')}.`);

  let out = '';
  for (const part of parts) {
    if ((out ? out.length + 1 : 0) + part.length > MAX_CHARS) break;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}

/**
 * Extract Prospect Context from the visible lines of a Facebook profile/page.
 * Reads only (1) the profile header block between the display name and the
 * tab bar and (2) profile-owned sections (Intro, Details, Contact info, Links,
 * Personal details, Work/Education...). Returns '' when nothing validated
 * survives — never a page dump.
 */
export function extractFacebookProspectContextFromLines(lines: string[], name: string): string {
  const all = lines.map(clean).filter(Boolean);
  const nameLower = lower(clean(name));
  const fields: Field[] = [];

  // (1) Header block. Normally anchored on the display-name line; if the
  // exact name line is not found (badge text, alternate spelling), fall back
  // to the block before an early tab bar, skipping its first (name) line.
  let nameIndex = nameLower ? all.findIndex((line) => lower(line) === nameLower) : -1;
  if (nameIndex < 0 && nameLower) nameIndex = all.findIndex((line) => lower(line).startsWith(`${nameLower} `) && line.length <= nameLower.length + 20);
  let headerStart = nameIndex >= 0 ? nameIndex + 1 : -1;
  if (headerStart < 0) {
    const earlyTab = all.findIndex((line) => TAB_BAR_LINE.test(line));
    if (earlyTab > 0 && earlyTab <= 12) headerStart = 1;
  }
  if (headerStart >= 0) {
    const after = all.slice(headerStart);
    // The real tab bar starts with "All" (or "Group posts" on a group-member
    // card). Header buttons such as "Following" / "Followers" share tab
    // words, so only fall back to generic tab words when no anchor exists.
    const anchoredEnd = after.slice(0, 16).findIndex((line) => /^(?:all|group posts)$/i.test(line) || INFO_SECTION.test(line));
    const tabIndex = anchoredEnd >= 0
      ? anchoredEnd
      : after.findIndex((line) => TAB_BAR_LINE.test(line) || SECTION_STOP.test(line) || INFO_SECTION.test(line));
    const bounded = tabIndex >= 0;
    for (const line of (bounded ? after.slice(0, tabIndex) : after.slice(0, 4)).slice(0, 10)) {
      // Without a tab bar to bound the header, never accept prose that could
      // be the first line of a post.
      if (!bounded && line.length > 120) continue;
      const field = classifyLine(line, name, 'header');
      if (field) fields.push(field);
    }
  }

  // (2) Profile-owned sections, each read from its heading to the next
  // heading / stop marker. A post author line (the name again), a timestamp or
  // a group-card label also ends the section.
  let region: Region | null = null;
  let remaining = 0;
  for (let index = Math.max(headerStart, 0); index < all.length; index += 1) {
    const line = all[index];
    if (INFO_SECTION.test(line)) {
      region = /^intro$/i.test(line) ? 'intro' : /^(?:links|websites and social links)$/i.test(line) ? 'links' : 'section';
      remaining = 10;
      continue;
    }
    if (!region || remaining <= 0) continue;
    if (SECTION_STOP.test(line) || TIMESTAMP_LINE.test(line) || GROUP_CARD_LINE.test(line)) {
      region = null;
      remaining = 0;
      continue;
    }
    // The page's own name inside Contact info is the Messenger link; inside
    // any other section it is a post author line (the feed has begun).
    if (lower(line) === nameLower) {
      if (region !== 'section') { region = null; remaining = 0; }
      continue;
    }
    remaining -= 1;
    const field = classifyLine(line, name, region);
    if (field) fields.push(field);
  }

  // Header bios come first; section fields fill in.
  return assemble(fields);
}

/** DOM entry point used by the Facebook adapter. */
export function extractFacebookProspectContext(root: Element | null, name: string): string {
  return extractFacebookProspectContextFromLines(facebookVisibleLines(root), name);
}

/**
 * Display-time guard for Facebook prospect context that was produced by an
 * older build (or echoed back by the server). Current-format context (one
 * concise string) is kept when it carries no pollution; a legacy multi-line
 * blob is re-filtered line by line, and anything that looks like a page dump
 * collapses to ''.
 */
export function sanitizeFacebookProspectContext(value: unknown, name: string): string {
  const text = String(value || '').replace(/^About:\s*/i, '').trim();
  if (!text) return '';
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  // A stored context with this many lines was a page dump; do not try to
  // salvage fragments of other people's posts out of it.
  if (lines.length > 12) return '';
  if (lines.length <= 2 && text.length <= MAX_CHARS && lines.every((line) => !UI_ANYWHERE.test(line) && (line.match(/facebook/gi) || []).length < 2)) {
    return lines.join(' ');
  }
  const kept: string[] = [];
  for (const line of lines) {
    const cleaned = cleanFacebookProspectLine(line, name);
    if (cleaned && !kept.some((k) => lower(k) === lower(cleaned))) kept.push(cleaned);
    if (kept.length >= 5) break;
  }
  return kept.join('\n').slice(0, MAX_CHARS).trim();
}
