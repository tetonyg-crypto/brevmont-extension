/**
 * MAIN-world reader for dealer inventory pages.
 *
 * WHY THIS EXISTS: Dealer.com exposes its per-vehicle data on the PAGE global
 * `window.DDC.dataLayer.vehicles`. A normal (ISOLATED-world) content script
 * CANNOT see page globals. The repo's established pattern for touching a page
 * global is a MAIN-world execution surface (see verification-bridge.content.ts,
 * `world: 'MAIN'`). Dealer domains are arbitrary and not in host_permissions,
 * so a statically-registered MAIN-world content script can't match them.
 *
 * Instead we inject a self-contained function into the MAIN world of the
 * ACTIVE tab via chrome.scripting.executeScript({ world: 'MAIN', func }). The
 * user opening the side panel by clicking the toolbar icon grants activeTab,
 * which authorizes this injection on whatever dealer site they're viewing —
 * no broad host permission required. Same executeScript surface already used
 * in sidepanel/main.ts (ensureContentScript).
 *
 * The injected function is SERIALIZED, so it must be fully self-contained
 * (no imports, no outer-scope refs). It returns raw data; all parsing is done
 * by the pure functions in scrape.ts back in the side panel.
 */

import type { LivePageRead } from './types';

/**
 * Runs in the page's MAIN world. Self-contained on purpose.
 * Reads the platform data layer, page HTML, detection counts, and pagination
 * URLs. Same-origin `fetch` for other pages happens later via fetchPageHtml.
 */
function mainWorldReadFn(): {
  platform: string;
  dataLayer: unknown[];
  html: string;
  pageUrls: string[];
  jsonLdVehicleCount: number;
  vehicleCardCount: number;
  url: string;
} {
  const safeClone = (val: unknown): unknown[] => {
    try {
      return JSON.parse(JSON.stringify(val ?? []));
    } catch {
      return [];
    }
  };

  const w = window as unknown as Record<string, any>;
  let platform = 'unknown';
  let dataLayer: unknown[] = [];

  // Dealer.com — the Phase-1 must-work platform.
  if (w.DDC && w.DDC.dataLayer && Array.isArray(w.DDC.dataLayer.vehicles)) {
    platform = 'dealercom';
    dataLayer = safeClone(w.DDC.dataLayer.vehicles);
  } else if (w.DealerOn && w.DealerOn.inventory && Array.isArray(w.DealerOn.inventory.vehicles)) {
    // DealerOn stub — real global path TBD; falls through to JSON-LD/DOM if empty.
    platform = 'dealeron';
    dataLayer = safeClone(w.DealerOn.inventory.vehicles);
  } else if (Array.isArray(w.__CDK_VEHICLES__)) {
    platform = 'cdk';
    dataLayer = safeClone(w.__CDK_VEHICLES__);
  } else if (w.DDCSiteData && Array.isArray(w.DDCSiteData.vehicles)) {
    platform = 'dealerinspire';
    dataLayer = safeClone(w.DDCSiteData.vehicles);
  }

  // Detection counts (cheap; done here so the isolated side panel need not
  // re-parse just to decide whether to show the Scan button).
  let jsonLdVehicleCount = 0;
  try {
    const blocks = document.querySelectorAll('script[type="application/ld+json"]');
    blocks.forEach((b) => {
      const txt = b.textContent || '';
      // Count Vehicle/Car nodes without a full parse loop.
      const m = txt.match(/"@type"\s*:\s*"(Vehicle|Car)"/gi);
      if (m) jsonLdVehicleCount += m.length;
    });
  } catch { /* noop */ }

  let vehicleCardCount = 0;
  try {
    vehicleCardCount = document.querySelectorAll(
      'li.vehicle-card, .vehicle-card, [data-vehicle-card]',
    ).length;
  } catch { /* noop */ }

  // Pagination discovery: rel=next + pager anchors + numbered page links.
  const pageUrls: string[] = [];
  const seen = new Set<string>();
  const pushUrl = (href: string | null): void => {
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, window.location.href).href;
    } catch {
      return;
    }
    if (abs === window.location.href) return;
    if (seen.has(abs)) return;
    // Only same-origin pages (so a later fetch is allowed).
    try {
      if (new URL(abs).origin !== window.location.origin) return;
    } catch {
      return;
    }
    seen.add(abs);
    pageUrls.push(abs);
  };
  try {
    document.querySelectorAll<HTMLAnchorElement>(
      'a[rel="next"], link[rel="next"], .pagination a[href], nav[aria-label*="page" i] a[href], a[href*="?start="], a[href*="&start="], a[href*="page="]',
    ).forEach((a) => pushUrl(a.getAttribute('href')));
  } catch { /* noop */ }

  return {
    platform,
    dataLayer,
    html: document.documentElement.outerHTML,
    pageUrls,
    jsonLdVehicleCount,
    vehicleCardCount,
    url: window.location.href,
  };
}

/** Runs in the page's MAIN world. Cheap detection signals only (no full HTML). */
function mainWorldDetectFn(): {
  hasPlatformDataLayer: boolean;
  jsonLdVehicleCount: number;
  vehicleCardCount: number;
  url: string;
} {
  const w = window as unknown as Record<string, any>;
  const hasPlatformDataLayer = Boolean(
    (w.DDC && w.DDC.dataLayer && Array.isArray(w.DDC.dataLayer.vehicles) && w.DDC.dataLayer.vehicles.length)
    || (w.DealerOn && w.DealerOn.inventory && Array.isArray(w.DealerOn.inventory.vehicles))
    || Array.isArray(w.__CDK_VEHICLES__)
    || (w.DDCSiteData && Array.isArray(w.DDCSiteData.vehicles)),
  );
  let jsonLdVehicleCount = 0;
  try {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((b) => {
      const m = (b.textContent || '').match(/"@type"\s*:\s*"(Vehicle|Car)"/gi);
      if (m) jsonLdVehicleCount += m.length;
    });
  } catch { /* noop */ }
  let vehicleCardCount = 0;
  try {
    vehicleCardCount = document.querySelectorAll('li.vehicle-card, .vehicle-card, [data-vehicle-card]').length;
  } catch { /* noop */ }
  return { hasPlatformDataLayer, jsonLdVehicleCount, vehicleCardCount, url: window.location.href };
}

/** Runs in the page's MAIN world. Same-origin fetch of an inventory page. */
function mainWorldFetchFn(pageUrl: string): Promise<string> {
  return fetch(pageUrl, { credentials: 'include' })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
}

/**
 * Inject mainWorldReadFn into the MAIN world of `tabId` and return the read.
 * Throws a rep-friendly message if scripting is unavailable / blocked.
 */
export async function readLivePage(tabId: number): Promise<LivePageRead> {
  if (!chrome.scripting?.executeScript) {
    throw new Error('Reload the extension and this page, then try Scan again.');
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: mainWorldReadFn,
  });
  const value = result?.result as LivePageRead | undefined;
  if (!value) {
    throw new Error('Could not read this page. Reload the inventory page and try again.');
  }
  return value;
}

/** Inject the detection-only reader; returns the signals used to show Scan. */
export async function detectLivePage(tabId: number): Promise<{
  hasPlatformDataLayer: boolean;
  jsonLdVehicleCount: number;
  vehicleCardCount: number;
  url: string;
}> {
  if (!chrome.scripting?.executeScript) {
    return { hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: '' };
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: mainWorldDetectFn,
    });
    return (result?.result as any) || { hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: '' };
  } catch {
    return { hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: '' };
  }
}

/** Same-origin fetch of an additional inventory page, run in the page context. */
export async function fetchPageHtml(tabId: number, pageUrl: string): Promise<string> {
  if (!chrome.scripting?.executeScript) return '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: mainWorldFetchFn,
      args: [pageUrl],
    });
    return (result?.result as string) || '';
  } catch {
    return '';
  }
}
