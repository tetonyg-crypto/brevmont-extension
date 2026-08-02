/**
 * Rep-side inventory SCANNER — pure, unit-testable extraction.
 *
 * Priority order per page (spec §SCANNER STRATEGY):
 *   1. Platform data layer  (Dealer.com window.DDC.dataLayer.vehicles) — best.
 *   2. JSON-LD              (schema.org Vehicle/Car/Product) — reliable.
 *   3. DOM .vehicle-card    (innerText + img + <a href>) — last resort.
 *
 * All functions here are PURE (no chrome.*, no live DOM globals beyond the
 * DOM node you pass in). The live-tab plumbing (MAIN-world read, fetch,
 * pagination loop, progress) lives in scanRunner.ts / mainWorldReader.ts.
 *
 * JSON-LD path ported from brevmont-api/lib/inventoryScrape.js
 * (normalizeLdVehicle / extractJsonLdVehicles) and EXTENDED with mileage
 * (mileageFromOdometer.value) + photos (image), which the server port drops.
 */

import type { InventoryPageInput, ScrapedVehicle } from './types';

// ── primitives ────────────────────────────────────────────────────────────

export function coercePrice(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return coercePrice(o.price ?? o.value ?? o.amount ?? null);
  }
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function coerceInt(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return coerceInt(o.value ?? o.amount ?? null);
  }
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function coerceYear(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Strip Dealer.com / CDN size + policy query params so we keep the full-res
 * original. Removes impolicy, w, h, width, height, quality, sm, etc. If the
 * result would have an empty query, drop the trailing '?'.
 */
export function stripPhotoSizeParams(rawUrl: unknown): string | null {
  const s = str(rawUrl);
  if (!s) return null;
  const qIdx = s.indexOf('?');
  if (qIdx === -1) return s;
  const base = s.slice(0, qIdx);
  const query = s.slice(qIdx + 1);
  const DROP = new Set([
    'impolicy', 'w', 'h', 'width', 'height', 'quality', 'q', 'sm',
    'sfx', 'downsize', 'resize', 'fit', 'crop', 'imdensity', 'imwidth',
  ]);
  const kept = query
    .split('&')
    .filter((pair) => {
      const key = pair.split('=')[0].toLowerCase();
      return key && !DROP.has(key);
    });
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function absoluteUrl(href: unknown, baseUrl: string): string | null {
  const s = str(href);
  if (!s) return null;
  try {
    return new URL(s, baseUrl).href;
  } catch {
    return s;
  }
}

function emptyVehicle(): ScrapedVehicle {
  return {
    stock_number: null,
    vin: null,
    year: null,
    make: null,
    model: null,
    trim: null,
    body_class: null,
    price: null,
    mileage: null,
    photos: [],
    vdp_url: null,
    source: 'scrape',
  };
}

/** A vehicle is worth keeping if we can identify it AND it carries some value. */
export function isIdentifiableVehicle(v: ScrapedVehicle): boolean {
  const hasId = Boolean(v.vin || v.stock_number || (v.year && v.make && v.model));
  return hasId;
}

/** VDP hop only when a vehicle is missing price OR mileage OR photos. */
export function vehicleMissingCoreData(v: ScrapedVehicle): boolean {
  return v.price == null || v.mileage == null || v.photos.length === 0;
}

// ── 1. Platform data layer (Dealer.com window.DDC.dataLayer.vehicles) ──────
//
// Real field names verified live on Dealer.com / Dave Smith Motors (2026-08):
//   vin, stockNumber, modelYear/year, make, model, trim, odometer,
//   bodyStyle, newOrUsed/inventoryType, exteriorColor,
//   pricing{askingPrice,internetPrice,salePrice,msrp}, images[]{uri}, link, uuid

function priceFromDdcPricing(pricing: unknown): number | null {
  if (!pricing || typeof pricing !== 'object') return null;
  const p = pricing as Record<string, unknown>;
  // Advertised selling price. VERIFIED on live Dealer.com data (Dave Smith
  // Motors): finalPrice/askingPrice is the real advertised price (e.g. $34,198),
  // while internetPrice is the HIGHER pre-discount/strike-through number
  // ($35,908). Preferring internetPrice listed cars ABOVE their real price — so
  // the order is finalPrice → askingPrice → salePrice → internetPrice → msrp.
  return (
    coercePrice(p.finalPrice) ??
    coercePrice(p.askingPrice) ??
    coercePrice(p.salePrice) ??
    coercePrice(p.internetPrice) ??
    coercePrice(p.msrp) ??
    null
  );
}

function photosFromDdcImages(images: unknown, baseUrl: string): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const img of images) {
    if (!img || typeof img !== 'object') {
      const direct = stripPhotoSizeParams(img);
      if (direct) out.push(direct);
      continue;
    }
    const uri = (img as Record<string, unknown>).uri
      ?? (img as Record<string, unknown>).url
      ?? (img as Record<string, unknown>).src;
    const stripped = stripPhotoSizeParams(uri);
    if (stripped) out.push(absoluteUrl(stripped, baseUrl) || stripped);
  }
  return [...new Set(out)];
}

export function normalizeDataLayerVehicle(raw: unknown, baseUrl: string): ScrapedVehicle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const v = emptyVehicle();

  v.vin = str(o.vin)?.toUpperCase() ?? null;
  v.stock_number = str(o.stockNumber ?? o.stockNo ?? o.stock) ?? null;
  v.year = coerceYear(o.modelYear ?? o.year);
  v.make = str(o.make);
  v.model = str(o.model);
  v.trim = str(o.trim);
  v.body_class = str(o.bodyStyle ?? o.bodyType) ?? null;
  v.mileage = coerceInt(o.odometer ?? o.mileage);
  v.price = priceFromDdcPricing(o.pricing) ?? coercePrice(o.price);
  v.photos = photosFromDdcImages(o.images, baseUrl);
  v.vdp_url = absoluteUrl(o.link ?? o.href ?? o.url, baseUrl);

  return isIdentifiableVehicle(v) ? v : null;
}

export function extractFromDataLayer(vehicles: unknown, baseUrl: string): ScrapedVehicle[] {
  if (!Array.isArray(vehicles)) return [];
  const out: ScrapedVehicle[] = [];
  for (const raw of vehicles) {
    const v = normalizeDataLayerVehicle(raw, baseUrl);
    if (v) out.push(v);
  }
  return out;
}

// ── 2. JSON-LD (ported from API, EXTENDED with mileage + photos) ───────────

const VEHICLE_LD_TYPES = new Set(['vehicle', 'car', 'product']);

function ldTypeMatches(typeVal: unknown): boolean {
  if (Array.isArray(typeVal)) return typeVal.some((t) => VEHICLE_LD_TYPES.has(String(t).toLowerCase()));
  return VEHICLE_LD_TYPES.has(String(typeVal || '').toLowerCase());
}

function mileageFromLd(obj: Record<string, unknown>): number | null {
  const odo = obj.mileageFromOdometer;
  if (odo != null) {
    if (typeof odo === 'object') return coerceInt((odo as Record<string, unknown>).value ?? odo);
    return coerceInt(odo);
  }
  return null;
}

function photosFromLd(obj: Record<string, unknown>, baseUrl: string): string[] {
  const image = obj.image;
  const raw: unknown[] = Array.isArray(image) ? image : image != null ? [image] : [];
  const out: string[] = [];
  for (const item of raw) {
    // image can be a string, or an ImageObject {url|contentUrl}.
    const candidate = typeof item === 'object' && item
      ? (item as Record<string, unknown>).url ?? (item as Record<string, unknown>).contentUrl
      : item;
    const stripped = stripPhotoSizeParams(candidate);
    if (stripped) out.push(absoluteUrl(stripped, baseUrl) || stripped);
  }
  return [...new Set(out)];
}

export function normalizeLdVehicle(raw: unknown, baseUrl: string): ScrapedVehicle | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!ldTypeMatches(obj['@type'])) return null;

  const v = emptyVehicle();
  const name = String(obj.name || obj.vehicleConfiguration || '');

  const brand = obj.brand as Record<string, unknown> | string | undefined;
  const manufacturer = obj.manufacturer as Record<string, unknown> | undefined;
  v.make = str(
    (typeof brand === 'object' ? brand?.name : brand)
    ?? manufacturer?.name
    ?? null,
  );

  const model = obj.model as Record<string, unknown> | string | undefined;
  v.model = str(typeof model === 'object' ? model?.name : model);

  v.year = coerceYear(obj.vehicleModelDate ?? obj.productionDate ?? null) ?? coerceYear(name);
  v.vin = str(obj.vehicleIdentificationNumber)?.toUpperCase() ?? null;
  v.stock_number = str(obj.sku ?? obj.mpn) ?? null;
  v.trim = str(obj.vehicleTrim ?? obj.vehicleConfiguration) ?? null;
  v.price = coercePrice(obj.offers) ?? coercePrice(obj.price);
  v.mileage = mileageFromLd(obj);
  v.photos = photosFromLd(obj, baseUrl);
  v.vdp_url = absoluteUrl(obj.url ?? obj.mainEntityOfPage, baseUrl);

  return isIdentifiableVehicle(v) ? v : null;
}

/** Regex-scan HTML for ld+json blocks, collect all Vehicle/Car/Product nodes. */
export function extractJsonLdVehicles(html: string, baseUrl: string): ScrapedVehicle[] {
  if (!html || typeof html !== 'string') return [];
  const vehicles: ScrapedVehicle[] = [];
  const blockRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // malformed block — skip, don't throw
    }
    const candidates: unknown[] = [];
    const collect = (node: unknown): void => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (typeof node !== 'object') return;
      candidates.push(node);
      const n = node as Record<string, unknown>;
      if (Array.isArray(n['@graph'])) (n['@graph'] as unknown[]).forEach(collect);
      if (Array.isArray(n.itemListElement)) (n.itemListElement as unknown[]).forEach(collect);
      if (n.item) collect(n.item);
    };
    collect(parsed);
    for (const c of candidates) {
      const v = normalizeLdVehicle(c, baseUrl);
      if (v) vehicles.push(v);
    }
  }
  return vehicles;
}

// ── 3. DOM .vehicle-card fallback ──────────────────────────────────────────

const KNOWN_MAKES = [
  'chevrolet', 'chevy', 'gmc', 'ford', 'ram', 'dodge', 'jeep', 'chrysler',
  'toyota', 'honda', 'nissan', 'hyundai', 'kia', 'mazda', 'subaru', 'buick',
  'cadillac', 'lincoln', 'volkswagen', 'audi', 'bmw', 'mercedes-benz', 'mercedes',
  'lexus', 'acura', 'infiniti', 'volvo', 'genesis', 'mitsubishi', 'tesla',
  'porsche', 'jaguar', 'land rover', 'mini', 'fiat', 'alfa romeo',
];

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseTitleParts(title: string): Pick<ScrapedVehicle, 'year' | 'make' | 'model' | 'trim'> {
  const out = { year: null as number | null, make: null as string | null, model: null as string | null, trim: null as string | null };
  const t = title.replace(/\s+/g, ' ').trim();
  const yearMatch = t.match(/\b(19|20)\d{2}\b/);
  out.year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  // Take everything after the year, then split off make + model + trim.
  const afterYear = yearMatch ? t.slice((yearMatch.index || 0) + 4).trim() : t;
  const lower = afterYear.toLowerCase();
  const make = KNOWN_MAKES.find((m) => lower.startsWith(m));
  if (make) {
    out.make = make === 'chevy' ? 'Chevrolet' : afterYear.slice(0, make.length);
    const rest = afterYear.slice(make.length).trim().split(/\s+/);
    if (rest.length) {
      out.model = rest[0];
      if (rest.length > 1) out.trim = rest.slice(1).join(' ');
    }
  } else {
    const words = afterYear.split(/\s+/);
    out.make = words[0] || null;
    out.model = words[1] || null;
    if (words.length > 2) out.trim = words.slice(2).join(' ');
  }
  return out;
}

/**
 * Parse Dealer.com-style .vehicle-card elements from a parsed DOM.
 * Accepts any ParentNode (a Document, or a container element). Uses only
 * standard DOM APIs so it runs in the side-panel document AND under a
 * DOM-providing test environment (happy-dom).
 */
export function extractDomCards(root: ParentNode, baseUrl: string): ScrapedVehicle[] {
  const cards = root.querySelectorAll(
    'li.vehicle-card, .vehicle-card, [data-vehicle-card], li[data-vin]',
  );
  const out: ScrapedVehicle[] = [];
  cards.forEach((card) => {
    const v = emptyVehicle();
    const el = card as HTMLElement;

    // Data attributes are the cleanest signal when present.
    v.vin = str(el.getAttribute('data-vin'))?.toUpperCase() ?? null;
    v.stock_number = str(el.getAttribute('data-stock') ?? el.getAttribute('data-stocknumber')) ?? null;

    const titleEl = el.querySelector(
      '.vehicle-card-title, .vehicle-title, [class*="title"], h1, h2, h3',
    );
    const titleText = textOf(titleEl) || textOf(el).slice(0, 120);
    const parts = parseTitleParts(titleText);
    v.year = parts.year;
    v.make = parts.make;
    v.model = parts.model;
    v.trim = parts.trim;

    const cardText = textOf(el);
    const mileageMatch = cardText.match(/([\d,]+)\s*(?:miles|mi\b)/i);
    if (mileageMatch) v.mileage = coerceInt(mileageMatch[1]);

    // Take the largest-looking $ figure as the asking price.
    const priceMatches = cardText.match(/\$\s?([\d,]{4,7})/g) || [];
    const prices = priceMatches
      .map((p) => coercePrice(p))
      .filter((n): n is number => n != null);
    if (prices.length) v.price = Math.max(...prices);

    const img = el.querySelector('img');
    const imgSrc = img?.getAttribute('src')
      || img?.getAttribute('data-src')
      || img?.getAttribute('data-lazy');
    const stripped = stripPhotoSizeParams(imgSrc);
    if (stripped) v.photos = [absoluteUrl(stripped, baseUrl) || stripped];

    const link = el.querySelector('a[href]');
    v.vdp_url = absoluteUrl(link?.getAttribute('href'), baseUrl);

    if (isIdentifiableVehicle(v)) out.push(v);
  });
  return out;
}

// ── Merge + dedupe ─────────────────────────────────────────────────────────

function vehicleKey(v: ScrapedVehicle): string {
  if (v.vin) return `vin:${v.vin}`;
  if (v.stock_number) return `stock:${v.stock_number.toLowerCase()}`;
  return `ymm:${v.year}|${(v.make || '').toLowerCase()}|${(v.model || '').toLowerCase()}|${v.price}`;
}

/** Prefer non-null fields from `primary`, fill gaps from `secondary`. */
export function mergeVehicle(primary: ScrapedVehicle, secondary: ScrapedVehicle): ScrapedVehicle {
  return {
    stock_number: primary.stock_number ?? secondary.stock_number,
    vin: primary.vin ?? secondary.vin,
    year: primary.year ?? secondary.year,
    make: primary.make ?? secondary.make,
    model: primary.model ?? secondary.model,
    trim: primary.trim ?? secondary.trim,
    body_class: primary.body_class ?? secondary.body_class,
    price: primary.price ?? secondary.price,
    mileage: primary.mileage ?? secondary.mileage,
    photos: primary.photos.length ? primary.photos : secondary.photos,
    vdp_url: primary.vdp_url ?? secondary.vdp_url,
    source: 'scrape',
  };
}

/** Dedupe by VIN (then stock, then year/make/model/price), merging partials. */
export function dedupeByVin(vehicles: ScrapedVehicle[]): ScrapedVehicle[] {
  const map = new Map<string, ScrapedVehicle>();
  for (const v of vehicles) {
    const key = vehicleKey(v);
    const existing = map.get(key);
    map.set(key, existing ? mergeVehicle(existing, v) : v);
  }
  return [...map.values()];
}

// ── Per-page orchestration (a → b → c, then merge) ─────────────────────────

/**
 * Extract every vehicle from ONE page's raw inputs in priority order, then
 * merge/dedupe. Data-layer wins; JSON-LD + DOM cards backfill anything the
 * data layer missed (and cover non-Dealer.com pages).
 */
export function extractVehiclesFromPage(input: InventoryPageInput): ScrapedVehicle[] {
  const { dataLayer, html, sourceUrl } = input;
  const collected: ScrapedVehicle[] = [];

  if (Array.isArray(dataLayer) && dataLayer.length) {
    collected.push(...extractFromDataLayer(dataLayer, sourceUrl));
  }
  if (html) {
    collected.push(...extractJsonLdVehicles(html, sourceUrl));
    // DOM card parse needs a real DOM. Guard for environments without one.
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        collected.push(...extractDomCards(doc, sourceUrl));
      } catch {
        /* ignore parse failures */
      }
    }
  }
  return dedupeByVin(collected);
}

// ── Detection ("is this a dealer inventory SRP?") ──────────────────────────

export interface DetectionSignals {
  hasPlatformDataLayer: boolean;
  jsonLdVehicleCount: number;
  vehicleCardCount: number;
  url: string;
}

const INVENTORY_URL_RE = /\/(inventory|used|new|for-sale|vehicles?|preowned|pre-owned)\b/i;

export function detectInventorySite(sig: DetectionSignals): boolean {
  if (sig.hasPlatformDataLayer) return true;
  if (sig.jsonLdVehicleCount >= 1) return true;
  if (sig.vehicleCardCount >= 3) return true;
  if (INVENTORY_URL_RE.test(String(sig.url || ''))) return true;
  return false;
}
