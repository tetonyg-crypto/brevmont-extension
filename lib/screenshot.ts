/**
 * Tool: lib/screenshot.ts
 * Purpose: Capture the visible tab as a PNG data URL, resize to a max
 *          dimension via canvas, return the resized data URL. Attached
 *          to support tickets so the founder can see exactly what the rep
 *          was looking at — eliminates "send me a screenshot" follow-ups.
 * Inputs:  Optional tabId (defaults to active tab)
 * Outputs: { dataUrl, byteLength, errorReason } — null dataUrl on failure
 * Dependencies: chrome.tabs.captureVisibleTab (requires `activeTab` or
 *               `<all_urls>` host permission), HTMLCanvasElement (popup ctx)
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation.
 *
 * GRACEFUL DEGRADATION:
 *   The support modal NEVER blocks on screenshot capture. If this function
 *   returns null, the ticket still submits — just with `screenshot_failed`
 *   in the breadcrumbs and no image.
 *
 * Permissions:
 *   - `activeTab` is sufficient when capture is initiated by a user gesture
 *     (clicking the "Get help" button counts).
 *   - For background-initiated captures (e.g. an automatic crash report),
 *     we'd need <all_urls>. Current scope is user-initiated only.
 *
 * Resize budget:
 *   - Native screenshot at 1440p ≈ 1-3MB raw PNG.
 *   - Resize to MAX_DIMENSION (1920px on the longer edge) keeps high-DPI
 *     screens readable while keeping payload around 500KB-1.5MB.
 *   - Backend caps at 6MB raw decoded; we're well under.
 */

const MAX_DIMENSION = 1920;
const RESIZE_QUALITY = 0.85;

export interface ScreenshotResult {
  dataUrl: string | null;
  byteLength: number;
  errorReason: string | null;
}

function decodeBase64Length(dataUrl: string): number {
  // data:image/png;base64,XXXXX → estimate decoded byte length from base64 chars.
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return dataUrl.length;
  const b64 = dataUrl.slice(idx + 1);
  // 4 base64 chars decode to 3 bytes; pad chars subtract.
  const padCount = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return Math.floor((b64.length * 3) / 4) - padCount;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = dataUrl;
  });
}

async function resize(dataUrl: string, maxDim: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (Math.max(w, h) <= maxDim) return dataUrl; // No resize needed.

  const scale = maxDim / Math.max(w, h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_2d_unavailable');
  ctx.drawImage(img, 0, 0, newW, newH);
  // PNG keeps text crisper than JPEG; budget allows it.
  return canvas.toDataURL('image/png', RESIZE_QUALITY);
}

/**
 * Capture the visible area of the user's active tab.
 *
 * Returns ScreenshotResult; never throws — caller can rely on errorReason
 * to surface the failure to the user without try/catch.
 */
export async function captureScreenshot(): Promise<ScreenshotResult> {
  let raw: string | null = null;
  try {
    raw = await new Promise<string>((resolve, reject) => {
      try {
        chrome.tabs.captureVisibleTab(undefined, { format: 'png' }, (dataUrl) => {
          const err = chrome.runtime.lastError;
          if (err || !dataUrl) {
            reject(new Error(err?.message || 'capture_returned_empty'));
          } else {
            resolve(dataUrl);
          }
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  } catch (e: any) {
    return {
      dataUrl: null,
      byteLength: 0,
      errorReason: e?.message || 'capture_failed',
    };
  }

  let resized: string;
  try {
    resized = await resize(raw, MAX_DIMENSION);
  } catch (e: any) {
    // Resize failure is non-fatal — fall back to raw.
    resized = raw;
  }

  return {
    dataUrl: resized,
    byteLength: decodeBase64Length(resized),
    errorReason: null,
  };
}
