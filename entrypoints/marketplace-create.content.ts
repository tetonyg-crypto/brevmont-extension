/**
 * Facebook Marketplace Vehicle-for-sale create page.
 *
 * Attempts mileage / price / description via native setters.
 * Does NOT select comboboxes and does NOT click Publish.
 * Photos: asks the background to fetch blobs, then DataTransfer onto file input.
 */
import {
  injectMarketplaceDraft,
  type MarketplaceDraftVehicle,
} from './lib/inventory/marketplaceInject';
import { applyIndependentZoom } from './lib/hostZoom';

export default defineContentScript({
  matches: [
    '*://www.facebook.com/marketplace/create/vehicle*',
    '*://facebook.com/marketplace/create/vehicle*',
  ],
  allFrames: false,
  runAt: 'document_idle',
  async main() {
    let draft: { payload?: { vehicle?: MarketplaceDraftVehicle } } | null = null;
    try {
      const stored = await chrome.storage.local.get('brevmont_marketplace_draft');
      draft = stored?.brevmont_marketplace_draft || null;
    } catch {
      return;
    }
    const vehicle = draft?.payload?.vehicle;
    if (!vehicle) return;

    const photoFiles = await fetchDraftPhotos(vehicle.photos || []);
    const report = await injectMarketplaceDraft(document, vehicle, photoFiles);
    renderBanner(vehicle, report.honest);
  },
});

async function fetchDraftPhotos(urls: string[]): Promise<File[]> {
  if (!urls.length) return [];
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'BREVMONT_FETCH_LISTING_PHOTOS',
      urls: urls.slice(0, 20),
    });
    if (!resp?.ok || !Array.isArray(resp.files)) return [];
    const files: File[] = [];
    for (const row of resp.files) {
      if (!row?.dataUrl || !row?.name) continue;
      const blob = await (await fetch(row.dataUrl)).blob();
      files.push(new File([blob], row.name, { type: row.type || blob.type || 'image/jpeg' }));
    }
    return files;
  } catch {
    return [];
  }
}

function renderBanner(vehicle: MarketplaceDraftVehicle, honest: string): void {
  document.getElementById('brevmont-marketplace-draft-banner')?.remove();
  const host = document.createElement('div');
  host.id = 'brevmont-marketplace-draft-banner';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .banner {
        position: fixed; z-index: 2147483646; left: 16px; bottom: 16px;
        max-width: 360px; padding: 12px 14px; border-radius: 10px;
        background: #F5F3EE; color: #0F1419; border: 1px solid #0D6E6E;
        font-family: Inter, system-ui, sans-serif; font-size: 12px; line-height: 1.45;
      }
      .kicker { color: #0D6E6E; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; font-size: 10px; }
      .title { margin: 4px 0 0; font-weight: 700; }
      .note { margin: 6px 0 0; color: #64748B; }
    </style>
    <div class="banner">
      <div class="kicker">Brevmont draft</div>
      <p class="title">${escapeHtml(vehicle.title || 'Vehicle')}</p>
      <p class="note">${escapeHtml(honest)} Confirm remaining fields, then publish yourself. Mark Posted in the inventory panel when the listing is live.</p>
    </div>
  `;
  applyIndependentZoom(host, document);
  document.documentElement.appendChild(host);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
