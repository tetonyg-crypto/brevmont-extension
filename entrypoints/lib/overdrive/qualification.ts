/**
 * Thread qualification — decides if an inbound Messenger thread is
 * Marketplace-origin and eligible for Overdrive.
 *
 * A thread qualifies if ANY of the following:
 *   1. URL is /marketplace/t/... (definitive)
 *   2. Thread header contains a listing pattern like "<Buyer> · YYYY Make Model"
 *      or "SOLD - YYYY Make Model" or plain vehicle string
 *   3. Any recent message contains "is this available", "still available",
 *      "still for sale" — Marketplace's default inquiry template
 *   4. Extension already has a customer_stamp on this thread with
 *      source_platform=facebook AND vehicle_interest set (existing lead
 *      that carried across)
 *
 * We're intentionally strict — false-negatives are safe (rep just handles
 * it manually), false-positives are dangerous (Overdrive replies to a
 * friend DM).
 */

export interface QualificationInput {
  url: string;
  header_text: string;
  recent_messages: string[];
  existing_stamp?: { source_platform?: string; vehicle_interest?: string | null } | null;
}

export interface QualificationResult {
  qualified: boolean;
  reason: string;
  vehicle_hint?: {
    year?: number;
    make?: string;
    model?: string;
    raw?: string;
  };
  listing_title_hint?: string;
}

const AUTO_MAKES_RE =
  /\b(Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\b/i;

const AVAILABILITY_RE = /\b(?:is|still)\s+(?:this|it|that|the (?:car|truck|vehicle))\s+available\b|\bstill\s+for\s+sale\b|\bis\s+this\s+still\s+available\b/i;

const VEHICLE_YEAR_MAKE_MODEL_RE = /\b(19|20)(\d{2})\s+([A-Z][A-Za-z-]+)\s+([A-Z][A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})/;

function parseVehicleHint(text: string): QualificationResult['vehicle_hint'] {
  const m = text.match(VEHICLE_YEAR_MAKE_MODEL_RE);
  if (!m) return undefined;
  const year = Number(`${m[1]}${m[2]}`);
  const makeCand = m[3];
  const model = m[4]?.replace(/[.,;].*$/, '').trim();
  const isKnownMake = AUTO_MAKES_RE.test(makeCand);
  if (!isKnownMake) return undefined;
  return {
    year,
    make: makeCand,
    model,
    raw: m[0],
  };
}

export function qualifyThread(input: QualificationInput): QualificationResult {
  const url = input.url || '';
  const header = input.header_text || '';
  const messages = Array.isArray(input.recent_messages) ? input.recent_messages : [];
  const stamp = input.existing_stamp || null;

  // ── Rule 4: existing stamp shortcut ────────────────────────────
  if (
    stamp &&
    String(stamp.source_platform || '').toLowerCase() === 'facebook' &&
    stamp.vehicle_interest
  ) {
    return {
      qualified: true,
      reason: 'existing_facebook_stamp_with_vehicle',
      vehicle_hint: parseVehicleHint(stamp.vehicle_interest) || {
        raw: stamp.vehicle_interest,
      },
    };
  }

  // ── Rule 1: Marketplace URL is definitive ──────────────────────
  if (/\/marketplace\/t\//i.test(url) || /messenger\.com\/marketplace\//i.test(url)) {
    return {
      qualified: true,
      reason: 'marketplace_thread_url',
      vehicle_hint: parseVehicleHint(header),
      listing_title_hint: header.split(/\s*[·•]\s*/)[1]?.trim() || undefined,
    };
  }

  // ── Rule 2: header contains a vehicle pattern ─────────────────
  const headerVehicle = parseVehicleHint(header);
  if (headerVehicle) {
    return {
      qualified: true,
      reason: 'header_vehicle_pattern',
      vehicle_hint: headerVehicle,
      listing_title_hint: header.split(/\s*[·•]\s*/)[1]?.trim() || undefined,
    };
  }

  // ── Rule 3: an availability question in recent messages ──────
  const allRecent = messages.join('\n');
  if (AVAILABILITY_RE.test(allRecent)) {
    return {
      qualified: true,
      reason: 'availability_question_in_thread',
      vehicle_hint: parseVehicleHint(allRecent),
    };
  }

  return { qualified: false, reason: 'no_marketplace_signals' };
}
