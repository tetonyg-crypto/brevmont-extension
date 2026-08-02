/**
 * Live-tab scan orchestrator. Runs in the side panel.
 *
 * Flow:
 *   1. Read the current page in the MAIN world (window.DDC.dataLayer.vehicles
 *      + full HTML + discovered pagination URLs).  → complete data for page 1.
 *   2. Detect whether this is a dealer inventory SRP.
 *   3. Extract page 1 (data layer → JSON-LD → DOM cards).
 *   4. Walk discovered pagination URLs (capped), fetching each page's HTML
 *      same-origin from the page context and extracting via JSON-LD + DOM
 *      cards. Report progress after each page. Dedupe by VIN.
 *   5. VDP hop ONLY for vehicles still missing price/mileage/photos.
 *
 * Extraction itself is delegated to the pure functions in scrape.ts.
 */

import {
  detectInventorySite,
  dedupeByVin,
  extractVehiclesFromPage,
  mergeVehicle,
  vehicleMissingCoreData,
} from './scrape';
import { fetchPageHtml, readLivePage } from './mainWorldReader';
import type { ScrapedVehicle } from './types';

export const MAX_PAGES = 40;
export const MAX_VDP_HOPS = 12;

export interface ScanProgress {
  phase: 'reading' | 'paginating' | 'vdp' | 'done';
  page: number;
  totalPages: number;
  vehiclesFound: number;
  message: string;
}

export interface ScanResult {
  detected: boolean;
  platform: string;
  vehicles: ScrapedVehicle[];
  pagesScanned: number;
  sourceUrl: string;
}

type ProgressFn = (p: ScanProgress) => void;

export async function scanInventory(
  tabId: number,
  onProgress: ProgressFn = () => {},
): Promise<ScanResult> {
  onProgress({ phase: 'reading', page: 0, totalPages: 1, vehiclesFound: 0, message: 'Reading this page…' });

  const live = await readLivePage(tabId);
  const detected = detectInventorySite({
    hasPlatformDataLayer: live.dataLayer.length > 0,
    jsonLdVehicleCount: live.jsonLdVehicleCount,
    vehicleCardCount: live.vehicleCardCount,
    url: live.url,
  });

  if (!detected) {
    onProgress({ phase: 'done', page: 0, totalPages: 0, vehiclesFound: 0, message: 'No inventory detected.' });
    return { detected: false, platform: live.platform, vehicles: [], pagesScanned: 0, sourceUrl: live.url };
  }

  const pageUrls = live.pageUrls.slice(0, MAX_PAGES - 1);
  const totalPages = 1 + pageUrls.length;
  let vehicles: ScrapedVehicle[] = extractVehiclesFromPage({
    dataLayer: live.dataLayer,
    html: live.html,
    sourceUrl: live.url,
  });

  onProgress({
    phase: 'paginating',
    page: 1,
    totalPages,
    vehiclesFound: vehicles.length,
    message: `Scanning page 1 of ${totalPages}… ${vehicles.length} vehicles found`,
  });

  let pageNum = 1;
  for (const url of pageUrls) {
    pageNum += 1;
    const html = await fetchPageHtml(tabId, url);
    if (html) {
      const pageVehicles = extractVehiclesFromPage({ dataLayer: null, html, sourceUrl: url });
      vehicles = dedupeByVin([...vehicles, ...pageVehicles]);
    }
    onProgress({
      phase: 'paginating',
      page: pageNum,
      totalPages,
      vehiclesFound: vehicles.length,
      message: `Scanning page ${pageNum} of ${totalPages}… ${vehicles.length} vehicles found`,
    });
  }

  // VDP hop for anything still missing price/mileage/photos (capped).
  const needHop = vehicles.filter((v) => vehicleMissingCoreData(v) && v.vdp_url).slice(0, MAX_VDP_HOPS);
  let hopDone = 0;
  for (const v of needHop) {
    hopDone += 1;
    onProgress({
      phase: 'vdp',
      page: pageNum,
      totalPages,
      vehiclesFound: vehicles.length,
      message: `Filling details ${hopDone} of ${needHop.length}…`,
    });
    const html = await fetchPageHtml(tabId, v.vdp_url as string);
    if (!html) continue;
    const [detail] = extractVehiclesFromPage({ dataLayer: null, html, sourceUrl: v.vdp_url as string });
    if (detail) {
      const idx = vehicles.indexOf(v);
      if (idx >= 0) vehicles[idx] = mergeVehicle(v, detail);
    }
  }

  onProgress({
    phase: 'done',
    page: pageNum,
    totalPages,
    vehiclesFound: vehicles.length,
    message: `Done. ${vehicles.length} vehicles found.`,
  });

  return { detected: true, platform: live.platform, vehicles, pagesScanned: totalPages, sourceUrl: live.url };
}
