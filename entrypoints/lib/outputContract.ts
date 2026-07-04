export type GenerationSectionKey = 'text' | 'email' | 'crm';

export interface ParsedGenerationSections {
  text: string;
  email: string;
  crm: string;
  raw: string;
}

const META_LINE_RE = /\b(?:classification|classifying|for your records|crm note for your records|internal instructions?|record classification|classify this interaction)\b/i;
const SECTION_BOUNDARY_RE = /^(?:TEXT(?:\s+MESSAGE)?|MESSAGE|EMAIL(?:\s+REPLY)?|CRM(?:\s+NOTE)?|CLASSIFICATION|INTERNAL|FOR YOUR RECORDS)\s*[:\-]?\s*$/i;

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

export function parseGenerationSections(raw: unknown, requestedType?: string): ParsedGenerationSections {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
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
