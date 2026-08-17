/**
 * Shared adapter helpers — the CORE that every platform inherits.
 *
 * Anything platform-agnostic lives here:
 *  - post-inject DOM verification
 *  - customer-name gate (isChannelOrUiName wrapper + candidate ranking)
 *  - vehicle extraction from any thread text
 *
 * Nothing here knows about a specific platform. Adapters call these
 * and get uniform safety.
 */

import { isChannelOrUiName, stripConversationWrapper } from '../leadContextScan';
import type { CustomerCandidate } from './types';

/** Cross-platform post-inject verification.
 *
 *  Success = the composer element contains the injected text (or the
 *  last 40 chars of it if the text is longer). Polls for up to 1500ms
 *  at 100ms intervals. Returns structured result; caller decides
 *  whether to surface a "check the composer" toast.
 *
 *  This is what makes the double-inject fix + isChannelOrUiName gate
 *  transfer to every platform for free — the shared core enforces
 *  verification uniformly.
 */
export async function verifyInject(
  composer: HTMLElement | null,
  text: string,
  { timeoutMs = 1500, pollMs = 100 } = {}
): Promise<{ verified: boolean; elapsed_ms: number; found_length: number }> {
  const startedAt = Date.now();
  if (!composer) {
    return { verified: false, elapsed_ms: 0, found_length: 0 };
  }
  const target = String(text || '').trim();
  const needle = target.length > 40 ? target.slice(-40) : target;
  if (!needle) {
    return { verified: false, elapsed_ms: 0, found_length: 0 };
  }
  while (Date.now() - startedAt < timeoutMs) {
    const rendered = (composer.textContent || (composer as HTMLInputElement | HTMLTextAreaElement).value || '');
    if (typeof rendered === 'string' && rendered.includes(needle)) {
      return {
        verified: true,
        elapsed_ms: Date.now() - startedAt,
        found_length: rendered.length,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const finalRendered = (composer.textContent || (composer as HTMLInputElement | HTMLTextAreaElement).value || '');
  return {
    verified: false,
    elapsed_ms: Date.now() - startedAt,
    found_length: typeof finalRendered === 'string' ? finalRendered.length : 0,
  };
}

/** Pick the highest-confidence CustomerCandidate whose name passes
 *  the channel/UI-name gate. Adapters + upstream scan return multiple
 *  candidates (adapter's own extraction, page-title parse, form-field
 *  scan, etc); this consolidates them.
 *
 *  Returns null if every candidate fails the gate — better "Hi there"
 *  than "Hi Messenger" (June 26 policy).
 */
export function pickCleanName(candidates: Array<CustomerCandidate | null | undefined>): CustomerCandidate | null {
  const valid: CustomerCandidate[] = [];
  for (const c of candidates) {
    if (!c || !c.name) continue;
    const trimmed = stripConversationWrapper(c.name);
    if (!trimmed) continue;
    if (isChannelOrUiName(trimmed)) continue;
    valid.push({ ...c, name: trimmed });
  }
  if (valid.length === 0) return null;
  valid.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return valid[0];
}

/** Regex-based vehicle year/make/model extractor. Same rules as
 *  qualification.ts uses — extracted to shared core so adapters
 *  don't reimplement. */
const AUTO_MAKES_RE =
  /\b(Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian|Mitsubishi|Genesis|Alfa\s*Romeo|Fiat|Land\s*Rover|Range\s*Rover)\b/i;

// Distinctive model words that are safe without a year/make (Gmail prose
// like "any tahoes or yukons" must not fall through as no-vehicle).
const UNAMBIG_MODEL_RE =
  /\b(Grand Cherokee|Grand Wagoneer|Bronco Sport|Escalade ESV|Santa Fe|Model [3YSX]|Silverado|Telluride|Tahoes?|Suburbans?|Traverse|Trailblazer|Camaro|Corvette|Tacoma|Tundra|4Runner|Sequoia|Camry|Corolla|RAV4|Highlander|Sienna|Venza|Yukons?|Acadia|Terrain|Canyon|Colorado|Equinox|Malibu|Impala|Cruze|F-?150|F-?250|F-?350|Explorer|Expedition|Bronco|Mustang|Wrangler|Cherokee|Wagoneer|Gladiator|Durango|ProMaster|Pacifica|Ridgeline|Odyssey|Civic|Accord|CR-V|HR-V|Sorento|Sportage|Seltos|Carnival|Outback|Forester|Crosstrek|Ascent|Impreza|WRX|Sentra|Altima|Maxima|Pathfinder|Murano|Armada|Elantra|Sonata|Tucson|Palisade|Enclave|Envision|Escalade)\b/i;

function normalizeModelToken(raw: string): string {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/^tahoes$/i.test(t)) return 'Tahoe';
  if (/^yukons$/i.test(t)) return 'Yukon';
  if (/^suburbans$/i.test(t)) return 'Suburban';
  return t;
}

export function extractVehicleHint(text: string): {
  raw?: string;
  year?: number;
  make?: string;
  model?: string;
} | null {
  const raw = String(text || '');
  const m = raw.match(/\b(19|20)(\d{2})\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)\s+([A-Z][A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})/);
  if (m) {
    const makeCand = m[3];
    if (AUTO_MAKES_RE.test(makeCand)) {
      return {
        raw: m[0],
        year: Number(`${m[1]}${m[2]}`),
        make: makeCand,
        model: m[4]?.replace(/[.,;].*$/, '').trim(),
      };
    }
  }
  // Informal inbound copy ("tahoes or yukons for around 40k") has no year.
  const modelOnly = raw.match(UNAMBIG_MODEL_RE);
  if (modelOnly?.[1]) {
    const model = normalizeModelToken(modelOnly[1]);
    return { raw: model, model };
  }
  return null;
}

/** Resolve the closest composer of a given kind on the current page.
 *  Used by every adapter's inject() as a fallback when the platform-
 *  specific selector chain misses. */
export function findGenericComposer(kind: 'text' | 'email' | 'crm_note' = 'text'): HTMLElement | null {
  if (kind === 'text') {
    return (
      (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
      (document.querySelector('textarea:not([readonly])') as HTMLElement | null) ||
      null
    );
  }
  if (kind === 'email') {
    return (
      (document.querySelector('div[role="textbox"][aria-label*="Message" i][contenteditable="true"]') as HTMLElement | null) ||
      (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null) ||
      null
    );
  }
  if (kind === 'crm_note') {
    return (
      (document.querySelector('textarea[name*="note" i]:not([readonly])') as HTMLElement | null) ||
      (document.querySelector('textarea:not([readonly])') as HTMLElement | null) ||
      (document.querySelector('div[contenteditable="true"]') as HTMLElement | null) ||
      null
    );
  }
  return null;
}

/** Stable conversation-key computer used by adapters that don't have
 *  a natural thread ID in the URL. */
export function stableKeyFromPath(prefix: string): string {
  try {
    const path = window.location.pathname;
    const hash = window.location.hash || '';
    return `${prefix}:${path}${hash}`;
  } catch {
    return `${prefix}:unknown`;
  }
}
