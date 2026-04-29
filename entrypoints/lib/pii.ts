/**
 * Tool: pii.ts
 * Purpose: PII scrubbing for telemetry. Strips emails, phone numbers, SSNs,
 *   credit-card-shaped digits, VINs, and bearer tokens from any string before
 *   it leaves the extension. Mirrors brevmont-api/lib/pii.ts so server-side
 *   logs stay consistent with client-side telemetry.
 * Inputs: any string or object
 * Outputs: scrubbed copy (originals are never mutated)
 * Dependencies: none (pure function, runs in service worker + content scripts)
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation — extension hardening sprint (E3)
 *
 * Why this matters: customer names, emails, and phone numbers flow through the
 * VinSolutions DOM. If they end up in error_message / stack / metadata fields
 * of telemetry POSTs, we have GDPR/CCPA exposure plus dealership trust risk
 * (their CRM data leaving their browser). Scrub at the boundary.
 *
 * Patterns:
 *   email           — local@domain.tld → [EMAIL]
 *   phone           — 307-690-0291, (307) 690.0291, +1 307 690 0291 → [PHONE]
 *   SSN             — 123-45-6789 → [SSN]
 *   credit card     — 16 digits with optional dashes/spaces → [CC]
 *   VIN             — 17-char alphanumeric (excludes I, O, Q) → [VIN]
 *   token=value     — token, key, password, secret, auth → [REDACTED]
 *   Bearer ...      → Bearer [REDACTED]
 *   long hex blob   — 32+ hex digits (likely a token/hash) → [HEX]
 */

const RX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone: 7-15 digit runs with common separators. Order matters — match before
// SSN so a 10-digit phone formatted XXX-XX-XXXX-style isn't misclassified.
const RX_PHONE = /(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const RX_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const RX_CC = /\b(?:\d[ -]?){13,19}\b/g;
const RX_VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const RX_TOKEN_KV = /\b(token|key|password|secret|auth|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi;
const RX_BEARER = /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g;
const RX_LONG_HEX = /\b[A-Fa-f0-9]{32,}\b/g;

/**
 * Scrub a single string. Returns the scrubbed copy. Safe to call on any
 * value — non-strings pass through untouched.
 */
export function scrubPII(text: string | null | undefined): string {
  if (text == null) return '';
  if (typeof text !== 'string') return String(text);

  return text
    .replace(RX_EMAIL, '[EMAIL]')
    .replace(RX_PHONE, '[PHONE]')
    .replace(RX_SSN, '[SSN]')
    .replace(RX_CC, '[CC]')
    .replace(RX_VIN, '[VIN]')
    .replace(RX_TOKEN_KV, '$1=[REDACTED]')
    .replace(RX_BEARER, 'Bearer [REDACTED]')
    .replace(RX_LONG_HEX, '[HEX]');
}

/**
 * Recursively scrub strings inside an object/array. Objects are walked;
 * arrays mapped; primitives passed through scrubPII when they're strings.
 * Cycles are detected via a WeakSet — circular refs become '[CYCLE]'.
 *
 * Performance: caps depth at 8 levels to avoid pathological deep payloads
 * blocking the service worker. Anything past depth 8 returns '[DEPTH]'.
 */
export function scrubPIIDeep<T = unknown>(value: T, _seen?: WeakSet<object>, _depth = 0): T {
  const seen = _seen || new WeakSet<object>();
  if (_depth > 8) return '[DEPTH]' as unknown as T;

  if (value == null) return value;
  const t = typeof value;
  if (t === 'string') return scrubPII(value as unknown as string) as unknown as T;
  if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return value;

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[CYCLE]' as unknown as T;
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((v) => scrubPIIDeep(v, seen, _depth + 1)) as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Field names that look like credentials get the value redacted entirely
      // even if it's not a string (numeric tokens, etc.) — defensive.
      if (/(token|key|password|secret|auth|cookie|session)/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubPIIDeep(v, seen, _depth + 1);
      }
    }
    return out as unknown as T;
  }

  return value;
}
