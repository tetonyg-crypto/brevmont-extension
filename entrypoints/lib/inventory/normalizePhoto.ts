/**
 * Client-side photo normalize for Marketplace-clean images (Phase 1).
 *
 * Uses pica (Lanczos) to resize→crop a dealer photo to a clean ~1200px
 * target at download time, so the rep gets usable images day-one WITHOUT a
 * server storage/sharp pipeline. The hub stores full-res source URLs; this
 * runs only when the rep clicks "Download photos".
 *
 * Watermark/logo removal is out of scope (burned-in overlays cannot be
 * removed client-side). We do a best-effort HEURISTIC flag only.
 *
 * CORS reality: dealer CDN images may not send Access-Control-Allow-Origin.
 * If the canvas is tainted we cannot read pixels or export a blob, so we fail
 * gracefully and the caller falls back to the original URL.
 */

import pica from 'pica';

export interface NormalizedPhoto {
  blob: Blob | null;
  dataUrl: string | null;
  width: number;
  height: number;
  /** true when a dealer logo/banner is likely burned into the image. */
  watermarkFlag: boolean;
  /** Set when normalize could not run (e.g. CORS-tainted); use originalUrl. */
  fallbackUrl: string | null;
}

const TARGET_W = 1200;
const TARGET_H = 900; // 4:3 Marketplace-clean

let picaInstance: ReturnType<typeof pica> | null = null;
function getPica(): ReturnType<typeof pica> {
  if (!picaInstance) picaInstance = pica();
  return picaInstance;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = url;
  });
}

/**
 * Best-effort watermark/banner heuristic. Dealer photos frequently carry a
 * near-solid colored bar (logo strip) along the top or bottom edge. We sample
 * the top and bottom ~10% bands and flag when a band is highly uniform AND not
 * plain white/near-white (a solid bar of brand color or black), which a normal
 * vehicle photo edge would not be.
 */
export function flagWatermarkFromImageData(data: ImageData): boolean {
  const { width, height } = data;
  const bandH = Math.max(4, Math.floor(height * 0.1));
  const checkBand = (yStart: number): boolean => {
    let rSum = 0, gSum = 0, bSum = 0, n = 0;
    for (let y = yStart; y < yStart + bandH && y < height; y += 2) {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        rSum += data.data[i]; gSum += data.data[i + 1]; bSum += data.data[i + 2];
        n += 1;
      }
    }
    if (!n) return false;
    const rAvg = rSum / n, gAvg = gSum / n, bAvg = bSum / n;
    // Variance across the band.
    let variance = 0;
    for (let y = yStart; y < yStart + bandH && y < height; y += 2) {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        variance += (data.data[i] - rAvg) ** 2 + (data.data[i + 1] - gAvg) ** 2 + (data.data[i + 2] - bAvg) ** 2;
      }
    }
    variance /= n;
    const isUniform = variance < 400; // low spread → solid bar
    const isNearWhite = rAvg > 235 && gAvg > 235 && bAvg > 235;
    return isUniform && !isNearWhite;
  };
  return checkBand(0) || checkBand(height - bandH);
}

/** Resize+crop a source image URL to a Marketplace-clean canvas. */
export async function normalizePhotoFromUrl(url: string): Promise<NormalizedPhoto> {
  const fail = (): NormalizedPhoto => ({
    blob: null, dataUrl: null, width: 0, height: 0, watermarkFlag: false, fallbackUrl: url,
  });
  if (typeof document === 'undefined') return fail();

  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    return fail();
  }

  // Center-crop the source to the 4:3 target aspect before Lanczos resize.
  const targetAspect = TARGET_W / TARGET_H;
  const srcAspect = img.naturalWidth / img.naturalHeight;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcAspect > targetAspect) {
    sw = Math.round(img.naturalHeight * targetAspect);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else {
    sh = Math.round(img.naturalWidth / targetAspect);
    sy = Math.round((img.naturalHeight - sh) / 2);
  }

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return fail();
  cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = TARGET_W;
  outCanvas.height = TARGET_H;

  let watermarkFlag = false;
  try {
    await getPica().resize(cropCanvas, outCanvas); // Lanczos by default
  } catch {
    return fail();
  }

  // Read pixels for the watermark heuristic (needs untainted canvas).
  try {
    const octx = outCanvas.getContext('2d');
    if (octx) watermarkFlag = flagWatermarkFromImageData(octx.getImageData(0, 0, TARGET_W, TARGET_H));
  } catch {
    // Tainted canvas — cannot read pixels; also cannot export a blob.
    return fail();
  }

  let blob: Blob | null = null;
  try {
    blob = await getPica().toBlob(outCanvas, 'image/jpeg', 0.9);
  } catch {
    return fail();
  }

  let dataUrl: string | null = null;
  try {
    dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
  } catch {
    dataUrl = null;
  }

  return { blob, dataUrl, width: TARGET_W, height: TARGET_H, watermarkFlag, fallbackUrl: null };
}
