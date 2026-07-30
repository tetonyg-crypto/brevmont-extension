export type GenerationSectionKey = 'text' | 'email' | 'crm';

export interface ParsedGenerationSections {
  text: string;
  email: string;
  crm: string;
  raw: string;
}

const META_LINE_RE = /\b(?:classification|classifying|for your records|crm note for your records|internal instructions?|record classification|classify this interaction)\b/i;
const SECTION_BOUNDARY_RE = /^(?:TEXT(?:\s+MESSAGE)?|MESSAGE|EMAIL(?:\s+REPLY)?|CRM(?:\s+NOTE)?|CLASSIFICATION|INTERNAL|FOR YOUR RECORDS)\s*[:\-]?\s*$/i;

// Fenced markers the model is instructed to emit for multi-section (type=all)
// generations. Unlike a bare "EMAIL:" line heading, these can't be confused
// with the model running sections together without a line break -- the
// bracket sequence is distinctive enough to find anywhere in the raw text,
// not just at the start of a line. Added 2026-07-09 after a P0 where the
// model wrote all three sections as one continuous paragraph and the
// line-based heading parser below silently collapsed everything into
// `sections.text`.
// Tolerant of bracket-count / whitespace / case drift (`[[TEXT]]`,
// `[[[ EMAIL ]]]`, lowercase `[[[email]]]`). The model is told to emit exactly
// three uppercase brackets, but a slip on a single marker previously caused
// that whole section to be dropped. Case-insensitive so a lowercase/mixed-case
// marker set still parses instead of collapsing to nothing. Requiring the
// TEXT|EMAIL|CRM token inside, AND requiring >=2 markers before entering the
// fenced path (see parseFencedSections), keeps a stray single `[[EMAIL]]` in
// ordinary prose from being mistaken for a section boundary.
const FENCE_MARKER_RE = /\[{2,4}\s*(TEXT|EMAIL|CRM(?:\s+NOTE)?)\s*\]{2,4}/gi;

// Rescue boundary for partial fence-marker compliance: if the model emits
// [[[TEXT]]] and [[[EMAIL]]] correctly but drifts back to a bare "CRM NOTE:"
// heading for the third section (no brackets, no line break), fence-only
// detection would silently merge that trailing text into the EMAIL chunk.
// Deliberately narrow to avoid false-splitting ordinary prose: only matches
// right after a sentence boundary (start of string, or `.`/`?`/`!` + space) --
// NOT after a comma or mid-clause -- and requires a colon (not a dash, which
// is common in casual phrasing like "message - see attached"). This is what
// keeps it from firing on something like "Hi John, Text: yes that works" or
// "left him a message - he'll call back", which are real dealership phrasing,
// while still catching "...Mercedes of Indiana. CRM NOTE: Contact Frank...".
const INLINE_HEADING_RE = /(^|[.?!])\s*(TEXT(?:\s+MESSAGE)?|MESSAGE|EMAIL(?:\s+REPLY)?|CRM(?:\s+NOTE)?)\s*:/gi;

function normalizeLines(value: unknown): string[] {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
}

function stripFenceAndMeta(value: unknown, kind: GenerationSectionKey): string {
  const lines = normalizeLines(value);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    const nextMeaningful = lines.slice(index + 1).map((candidate) => candidate.trim()).find(Boolean) || '';
    if (/^-{3,}$/.test(line)) {
      if (META_LINE_RE.test(nextMeaningful) || /^(?:CLASSIFICATION|INTERNAL|FOR YOUR RECORDS)\s*[:\-]?/i.test(nextMeaningful)) break;
      continue;
    }
    if (META_LINE_RE.test(line)) break;
    if (kind !== 'crm' && /^CRM(?:\s+NOTE)?\s*[:\-]?/i.test(line)) break;
    if (/^(?:CLASSIFICATION|INTERNAL|FOR YOUR RECORDS)\s*[:\-]?/i.test(line)) break;
    kept.push(rawLine);
  }
  return kept.join('\n')
    .replace(/[—–]/g, ', ')
    .replace(/^-{2,}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeCustomerFacingOutput(value: unknown, kind: GenerationSectionKey = 'text'): string {
  let text = stripFenceAndMeta(value, kind);
  if (kind !== 'crm') {
    text = text
      .split('\n')
      .filter((line) => !META_LINE_RE.test(line))
      .filter((line) => !/\bCRM\b/i.test(line))
      .join('\n');
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headingInfo(line: string): { key: GenerationSectionKey | null; inline: string } | null {
  const match = line.trim().match(/^(TEXT(?:\s+MESSAGE)?|MESSAGE|EMAIL(?:\s+REPLY)?|CRM(?:\s+NOTE)?)\s*[:\-]?\s*(.*)$/i);
  if (!match) return null;
  const label = match[1].toLowerCase();
  if (label.startsWith('email')) return { key: 'email', inline: match[2] || '' };
  if (label.startsWith('crm')) return { key: 'crm', inline: match[2] || '' };
  return { key: 'text', inline: match[2] || '' };
}

function fenceMarkerKey(label: string): GenerationSectionKey {
  const normalized = label.toLowerCase();
  if (normalized.startsWith('email')) return 'email';
  if (normalized.startsWith('crm')) return 'crm';
  return 'text';
}

interface SectionBoundary {
  start: number;
  contentStart: number;
  key: GenerationSectionKey;
}

// Splits on [[[TEXT]]] / [[[EMAIL]]] / [[[CRM NOTE]]] fence markers found
// anywhere in the raw text (not just at the start of a line), so a model
// that fails to add a line break before a marker still parses correctly.
// Also rescues bare "EMAIL:" / "CRM NOTE:" style headings that show up
// between fence markers (partial compliance) so they don't get swallowed
// into whichever fenced section precedes them. Returns null if no fence
// markers are present at all, so the caller can fall back to the older
// line-heading parser.
function parseFencedSections(text: string): Record<GenerationSectionKey, string[]> | null {
  const fenceMatches = Array.from(text.matchAll(FENCE_MARKER_RE));
  // Require at least two markers to treat this as a fenced multi-section
  // output. A single bracketed token (e.g. "Reply with [[EMAIL]] to get...")
  // is almost always ordinary prose, not a section boundary; splitting on it
  // fabricates an empty section and truncates the real draft. A genuine
  // type=all response always emits >=2 markers.
  if (fenceMatches.length < 2) return null;

  const boundaries: SectionBoundary[] = fenceMatches.map((match) => ({
    start: match.index ?? 0,
    contentStart: (match.index ?? 0) + match[0].length,
    key: fenceMarkerKey(match[1]),
  }));
  for (const match of text.matchAll(INLINE_HEADING_RE)) {
    const label = match[2];
    // Boundary starts at the label itself (e.g. "CRM NOTE"), not the leading
    // sentence terminator -- the terminator (". ") stays part of the prior
    // section's content.
    const labelStart = (match.index ?? 0) + match[0].lastIndexOf(label);
    if (boundaries.some((b) => labelStart >= b.start && labelStart < b.contentStart)) continue;
    boundaries.push({ start: labelStart, contentStart: (match.index ?? 0) + match[0].length, key: fenceMarkerKey(label) });
  }
  boundaries.sort((a, b) => a.start - b.start);

  const sections: Record<GenerationSectionKey, string[]> = { text: [], email: [], crm: [] };
  // Rescue a leading unlabeled chunk: if the first marker isn't at the very
  // start, the content before it is usually the TEXT draft whose own marker was
  // malformed or missing (the model is instructed to emit TEXT first). But a
  // model preamble ("Sure, here is the email you asked for:") also lands here,
  // and must NOT become a sendable text draft. Only rescue a chunk that reads
  // like a real customer-facing message: ends in sentence punctuation and does
  // not open with a lead-in phrase or end with a colon.
  if (boundaries.length && boundaries[0].start > 0 && boundaries[0].key !== 'text') {
    const lead = text.slice(0, boundaries[0].start).trim();
    const looksLikePreamble = /:$/.test(lead)
      || /^(?:sure|here(?:'s| is| are)?|okay|ok|got it|absolutely|of course|no problem|happy to|sounds good)\b/i.test(lead)
      || /\byou asked for\b/i.test(lead);
    if (lead && /[.?!]["']?$/.test(lead) && !looksLikePreamble) sections.text.push(lead);
  }
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    const end = index + 1 < boundaries.length ? boundaries[index + 1].start : text.length;
    const chunk = text.slice(boundary.contentStart, end).trim();
    if (chunk) sections[boundary.key].push(chunk);
  }
  return sections;
}

export function parseGenerationSections(raw: unknown, requestedType?: string): ParsedGenerationSections {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const fenced = parseFencedSections(text);
  if (fenced) {
    return {
      text: sanitizeCustomerFacingOutput(fenced.text.join('\n'), 'text'),
      email: sanitizeCustomerFacingOutput(fenced.email.join('\n'), 'email'),
      crm: sanitizeCustomerFacingOutput(fenced.crm.join('\n'), 'crm'),
      raw: text,
    };
  }

  const sections: Record<GenerationSectionKey, string[]> = { text: [], email: [], crm: [] };
  let active: GenerationSectionKey | null = null;

  const lines = normalizeLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (/^-{3,}$/.test(trimmed)) {
      const nextMeaningful = lines.slice(index + 1).map((candidate) => candidate.trim()).find(Boolean) || '';
      if (META_LINE_RE.test(nextMeaningful) || /^(?:CLASSIFICATION|INTERNAL|FOR YOUR RECORDS)\s*[:\-]?/i.test(nextMeaningful)) break;
      continue;
    }
    if (META_LINE_RE.test(trimmed)) break;
    const heading = headingInfo(trimmed);
    if (heading) {
      active = heading.key;
      if (active && heading.inline) sections[active].push(heading.inline);
      continue;
    }
    if (SECTION_BOUNDARY_RE.test(trimmed) && !heading) {
      active = null;
      continue;
    }
    if (active) sections[active].push(line);
  }

  const requested = String(requestedType || '').toLowerCase();
  if (!sections.text.length && !sections.email.length && !sections.crm.length) {
    if (requested === 'email') sections.email.push(text);
    else if (requested === 'crm' || requested === 'crm_note') sections.crm.push(text);
    else sections.text.push(text);
  }

  return {
    text: sanitizeCustomerFacingOutput(sections.text.join('\n'), 'text'),
    email: sanitizeCustomerFacingOutput(sections.email.join('\n'), 'email'),
    crm: sanitizeCustomerFacingOutput(sections.crm.join('\n'), 'crm'),
    raw: text,
  };
}
