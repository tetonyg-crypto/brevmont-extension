/**
 * Tool: lib/redact.ts
 * Purpose: Client-side PII redaction for support ticket submissions. Server
 *          redacts again (defense-in-depth) but client redaction means the
 *          founder's screen never shows raw SSN / credit card / phone in
 *          the dashboard, even if the founder is shoulder-surfed by a
 *          customer or the dashboard URL leaks.
 * Inputs:  String OR object with string fields
 * Outputs: Redacted string OR object with same shape
 * Dependencies: none
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation. Mirrors brevmont-api server-side redact.
 *
 * PATTERNS:
 *   * SSN: 123-45-6789 — never legitimate context for support
 *   * Phone: 555-123-4567, 555.123.4567, 555 123 4567 — too noisy if left
 *     in (rep's own number is fine on the ticket; we have rep_email anyway)
 *   * Credit card: 4111 1111 1111 1111, 4111-1111-1111-1111 — never
 *     legitimate; PCI compliance considers ANY storage of card data a
 *     violation, even temporary
 *   * License plate: ABC-1234 — heuristic only, has false positives. Off
 *     by default; opt-in via patterns array
 *
 * EMAIL ADDRESSES are intentionally NOT auto-redacted. Rep emails ARE the
 * legitimate ticket context (the founder needs to know who they're helping).
 * Customer emails embedded in URLs (`/customer/john%40example.com/...`) are
 * a different matter — those are rare in practice but if it becomes a problem,
 * add `email` to the default patterns.
 *
 * PERFORMANCE:
 *   * 4 small regex passes over a 5KB ticket body = sub-millisecond
 *   * Breadcrumbs are 50 items × ~200 chars = ~10KB; same budget
 */

export const PII_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  // Leading \b dropped so a parenthesized area code — "(307) 690-0291", an
  // extremely common US format — still matches (\b before "(" never holds).
  phone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  // 4-4-4-4 (Visa/MC/Discover) OR 4-6-5 (Amex). credit_card runs before phone
  // in redactText's ordered pass, so a card can't be partially eaten as a phone.
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{4}[\s-]?\d{6}[\s-]?\d{5}\b/g,
  license_plate: /\b[A-Z]{2,3}[-\s]?\d{3,4}\b/g,
} as const;

export type PiiPatternKey = keyof typeof PII_PATTERNS;

const REPLACEMENTS: Record<PiiPatternKey, string> = {
  ssn: '[SSN]',
  phone: '[PHONE]',
  email: '[EMAIL]',
  credit_card: '[CARD]',
  license_plate: '[PLATE]',
};

const DEFAULT_PATTERNS: PiiPatternKey[] = ['ssn', 'phone', 'credit_card'];

/**
 * Redact a single string. Each enabled pattern runs once; replacement
 * tokens are bracketed so the founder dashboard can render them as
 * inline pills if desired.
 */
export function redactText(input: string, patterns: PiiPatternKey[] = DEFAULT_PATTERNS): string {
  if (typeof input !== 'string' || !input) return input;
  let s = input;
  // Order matters: credit_card first (16 digits) so phone (10 digits) doesn't
  // catch a chunk of a card number first.
  const ordered: PiiPatternKey[] = ['credit_card', 'ssn', 'phone', 'email', 'license_plate'];
  for (const key of ordered) {
    if (!patterns.includes(key)) continue;
    s = s.replace(PII_PATTERNS[key], REPLACEMENTS[key]);
  }
  return s;
}

/**
 * Redact every string field in an object recursively. Non-string fields
 * pass through unchanged. Used for breadcrumbs which have a `data` blob.
 */
export function redactObject<T>(obj: T, patterns: PiiPatternKey[] = DEFAULT_PATTERNS): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactText(obj as string, patterns) as unknown as T;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, patterns)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = redactObject(v, patterns);
    }
    return out as T;
  }
  return obj;
}
