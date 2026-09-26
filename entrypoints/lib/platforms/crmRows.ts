/**
 * Direction for CRM message-grid rows (DealerSocket, Elead).
 *
 * These grids do not reliably mark who sent a row, and may be ordered
 * newest-first or oldest-first. A row is only inbound/outbound when the row
 * itself says so (class, data attribute, or a standalone direction cell);
 * otherwise 'unknown'. The last inbound is only chosen when it is
 * unambiguous: a single inbound row, or inbound rows that all carry a
 * parseable timestamp. Anything else returns '' -- wrong text is worse than
 * none downstream.
 */

import type { ThreadContext } from './types';

type Direction = ThreadContext['messages'][number]['direction'];

const INBOUND_RE = /^(?:inbound|incoming|received|from[-_ ]?customer|customer)$/i;
const OUTBOUND_RE = /^(?:outbound|outgoing|sent|from[-_ ]?(?:dealer|agent|rep|user)|agent|rep|dealer|salesperson)$/i;

function tokens(value: string): string[] {
  return String(value || '').split(/[\s]+/).map((t) => t.replace(/^(?:msg|message|row|direction)[-_]/i, '')).filter(Boolean);
}

export function crmRowDirection(row: HTMLElement): Direction {
  let inbound = false;
  let outbound = false;
  const mark = (value: string | null | undefined) => {
    for (const t of tokens(String(value || ''))) {
      if (INBOUND_RE.test(t)) inbound = true;
      else if (OUTBOUND_RE.test(t)) outbound = true;
    }
  };
  mark(row.className);
  mark(row.getAttribute('data-direction'));
  for (const cell of Array.from(row.querySelectorAll('td, [role="cell"], [data-direction]')) as HTMLElement[]) {
    mark(cell.getAttribute('data-direction'));
    const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 12) mark(text);
  }
  if (inbound === outbound) return 'unknown';
  return inbound ? 'inbound' : 'outbound';
}

const DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?))?/i;

function rowTimestamp(text: string): number | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const t = Date.parse(`${m[1]} ${m[2] || ''}`.trim());
  return Number.isFinite(t) ? t : null;
}

export function lastInboundFromRows(messages: ThreadContext['messages']): string {
  const inbound = messages.filter((m) => m.direction === 'inbound');
  if (inbound.length === 0) return '';
  if (inbound.length === 1) return inbound[0].text;
  const stamped = inbound.map((m) => ({ m, t: rowTimestamp(m.text) }));
  if (stamped.some((s) => s.t === null)) return '';
  stamped.sort((a, b) => (a.t as number) - (b.t as number));
  const newest = stamped[stamped.length - 1];
  if (stamped.length > 1 && stamped[stamped.length - 2].t === newest.t) return '';
  return newest.m.text;
}
