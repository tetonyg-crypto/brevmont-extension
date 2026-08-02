/**
 * Inventory → Marketplace Phase 1 — shared vehicle shape.
 *
 * This is the SINGLE contract the rep-side scanner emits, the API stores
 * (POST /api/v1/rep/inventory/scan), and the app hub reads. It is authored
 * against inventory-build-spec.md — do NOT rename fields without updating
 * the API + app agents.
 */

export interface ScrapedVehicle {
  stock_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  /** Optional. The API derives this via segmentForModel when absent. */
  body_class: string | null;
  /** Dollars, integer-ish number. $ and commas stripped. */
  price: number | null;
  /** Odometer, integer. */
  mileage: number | null;
  /** Full-res photo URLs, size query params stripped. */
  photos: string[];
  /** Vehicle detail page URL. */
  vdp_url: string | null;
  source: 'scrape';
}

/** Raw inputs for one inventory page, gathered from the live tab. */
export interface InventoryPageInput {
  /** Platform data-layer vehicle objects (e.g. Dealer.com window.DDC.dataLayer.vehicles). */
  dataLayer?: unknown[] | null;
  /** Full page HTML (for JSON-LD + .vehicle-card fallbacks). */
  html?: string | null;
  /** Absolute URL of the page these inputs came from. */
  sourceUrl: string;
}

/** What the MAIN-world reader hands back to the side-panel orchestrator. */
export interface LivePageRead {
  /** Detected inventory platform (dealercom, etc.) or 'unknown'. */
  platform: string;
  /** Raw data-layer vehicle objects (structured-cloned out of the page). */
  dataLayer: unknown[];
  /** Full page HTML for fallback extraction + detection. */
  html: string;
  /** Discovered pagination URLs (absolute), current page excluded. */
  pageUrls: string[];
  /** Counts used by the detection predicate. */
  jsonLdVehicleCount: number;
  vehicleCardCount: number;
  url: string;
}
