/**
 * Compact inventory lot inside the Chrome side panel.
 * Same records as /rep/inventory (live GET + public seed merge).
 * Isolated side-panel document, zoom:1, px fonts. Host Facebook zoom is ignored.
 */

import { getInventory, setInventoryStatus } from './apiClient';
import {
  assessListingReadiness,
  formatMiles,
  formatMoney,
  isApiBackedInventoryId,
  listingHeadline,
  listingStatusLabel,
  loadSeedListings,
  mergeLiveAndSeed,
  normalizeListingStatus,
  primaryPhoto,
  type InventoryListing,
  type ListingStatus,
} from './listing';

const POLL_MS = 3000;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chipClass(status: ListingStatus): string {
  return `inv-chip inv-chip-${status}`;
}

async function appBase(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['app_base_url']);
    return String(cfg?.app_base_url || 'https://app.brevmont.com').replace(/\/$/, '');
  } catch {
    return 'https://app.brevmont.com';
  }
}

export function renderMiniList(listings: InventoryListing[], query: string): string {
  const q = query.trim().toLowerCase();
  const rows = listings.filter((v) => {
    if (!q) return true;
    return listingHeadline(v).toLowerCase().includes(q)
      || String(v.stock_number || '').toLowerCase().includes(q)
      || String(v.vin || '').toLowerCase().includes(q);
  });
  if (!rows.length) return `<div class="inv-mini-empty">No vehicles match.</div>`;
  return rows.map((v) => {
    const status = normalizeListingStatus(v.posted_status);
    const ready = assessListingReadiness(v);
    const photo = primaryPhoto(v);
    return `
      <button class="inv-mini-card" type="button" data-inv-id="${esc(v.id)}">
        <span class="inv-mini-thumb">${photo ? `<img src="${esc(photo)}" alt="">` : '<span class="inv-mini-ph">No photo</span>'}</span>
        <span class="inv-mini-meta">
          <span class="inv-mini-title">${esc(listingHeadline(v))}</span>
          <span class="inv-mini-trim">${esc(v.trim || '')}</span>
          <span class="inv-mini-price">${esc(formatMoney(v.total_price ?? v.price))}</span>
          <span class="inv-mini-stock">${v.stock_number ? `Stock ${esc(v.stock_number)}` : 'Stock unavailable'} · ${esc(formatMiles(v.mileage))}</span>
          <span class="${chipClass(status)}">${esc(listingStatusLabel(status))}</span>
          <span class="inv-ready inv-ready-${ready.level}">${esc(ready.summary)}</span>
        </span>
      </button>`;
  }).join('');
}

export function renderMiniDetail(vehicle: InventoryListing): string {
  const photos = (vehicle.photos || []).filter(Boolean);
  const status = normalizeListingStatus(vehicle.posted_status);
  const ready = assessListingReadiness(vehicle);
  const api = isApiBackedInventoryId(vehicle.id);
  return `
    <div class="inv-mini-detail" data-inv-detail="${esc(vehicle.id)}">
      <button class="inv-mini-back" type="button" data-inv-back="1">Back to lot</button>
      <div class="inv-mini-gallery">
        ${photos[0] ? `<img src="${esc(photos[0])}" alt="">` : '<div class="inv-mini-ph">No photo</div>'}
        <div class="inv-mini-thumbs">${photos.slice(0, 8).map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>
      </div>
      <div class="inv-mini-title">${esc(listingHeadline(vehicle))}</div>
      <div class="inv-mini-price">${esc(formatMoney(vehicle.total_price ?? vehicle.price))}</div>
      <dl class="inv-mini-specs">
        <div><dt>VIN</dt><dd>${esc(vehicle.vin || 'Unavailable')}</dd></div>
        <div><dt>Stock</dt><dd>${esc(vehicle.stock_number || 'Unavailable')}</dd></div>
        <div><dt>Mileage</dt><dd>${esc(formatMiles(vehicle.mileage))}</dd></div>
      </dl>
      <p class="inv-mini-desc">${esc(vehicle.description || 'No description on this record.')}</p>
      <label class="inv-mini-status-label">Status
        <select class="inv-mini-status" ${api ? '' : 'disabled'} data-inv-status="${esc(vehicle.id)}" aria-label="Listing status">
          <option value="not_posted" ${status === 'not_posted' ? 'selected' : ''}>Not Posted</option>
          <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="posted" ${status === 'posted' ? 'selected' : ''}>Posted</option>
          <option value="sold" ${status === 'sold' ? 'selected' : ''}>Sold</option>
        </select>
      </label>
      ${api ? '' : '<p class="inv-mini-note">Status saves after this unit is in the live lot. Use Scan Inventory.</p>'}
      <p class="inv-ready inv-ready-${ready.level}">${esc(ready.summary)}</p>
      <button class="inv-scan-btn" type="button" data-inv-post="${esc(vehicle.id)}" ${ready.canInject ? '' : 'disabled'}>Post</button>
      ${status === 'pending' && api ? `<button class="inv-scan-btn secondary" type="button" data-inv-mark-posted="${esc(vehicle.id)}">Mark Posted</button>` : ''}
      <p class="inv-mini-note">Post injects this record into the open Marketplace create form when that tab is ready. Mileage, price, and description may fill. Year, make, model, body, colors, and Publish stay with you. Nothing posts by itself.</p>
      <div class="inv-mini-msg" id="o8-inv-mini-msg"></div>
    </div>`;
}

export interface MiniPanelHandles {
  overlay: HTMLElement;
  body: HTMLElement;
  openList: () => Promise<void>;
  openScan: () => void;
}

export function createMiniPanel(
  overlay: HTMLElement,
  body: HTMLElement,
  toast: (msg: string) => void,
  openScan: () => void,
  openHub: () => void,
): MiniPanelHandles {
  let listings: InventoryListing[] = [];
  let query = '';
  let openId: string | null = null;
  let poll: number | null = null;

  const setMsg = (text: string): void => {
    const el = body.querySelector('#o8-inv-mini-msg') as HTMLElement | null;
    if (el) el.textContent = text;
    else toast(text);
  };

  const paint = (): void => {
    if (openId) {
      const vehicle = listings.find((v) => v.id === openId);
      body.innerHTML = vehicle
        ? renderMiniDetail(vehicle)
        : '<div class="inv-mini-empty">Vehicle not found.</div>';
      return;
    }
    body.innerHTML = `
      <div class="inv-mini">
        <div class="inv-mini-toolbar">
          <input class="inv-mini-search" type="search" placeholder="Search year, make, stock" value="${esc(query)}" aria-label="Search inventory">
          <button class="inv-mini-link" type="button" data-inv-scan="1">Scan</button>
          <button class="inv-mini-link" type="button" data-inv-hub="1">Full page</button>
        </div>
        <div class="inv-mini-list">${renderMiniList(listings, query)}</div>
      </div>`;
  };

  const load = async (silent = false): Promise<void> => {
    if (!silent) body.innerHTML = '<div class="inv-scan-hint">Loading lot…</div>';
    try {
      const [live, seed] = await Promise.all([
        getInventory().catch(() => ({ vehicles: [] as InventoryListing[] })),
        appBase().then(loadSeedListings).catch(() => [] as InventoryListing[]),
      ]);
      listings = mergeLiveAndSeed(live.vehicles || [], seed);
      paint();
    } catch (err: any) {
      body.innerHTML = `<div class="inv-scan-hint">${esc(err?.message || 'Could not load inventory.')}</div>`;
    }
  };

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-inv-scan]')) { openScan(); return; }
    if (t.closest('[data-inv-hub]')) { openHub(); return; }
    if (t.closest('[data-inv-back]')) { openId = null; paint(); return; }
    const card = t.closest('[data-inv-id]') as HTMLElement | null;
    if (card?.dataset.invId) { openId = card.dataset.invId; paint(); return; }
  });

  overlay.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('inv-mini-search')) {
      query = t.value;
      const list = body.querySelector('.inv-mini-list');
      if (list) list.innerHTML = renderMiniList(listings, query);
    }
  });

  overlay.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (!t.matches('[data-inv-status]')) return;
    const id = t.getAttribute('data-inv-status') || '';
    const status = normalizeListingStatus(t.value);
    void (async () => {
      try {
        await setInventoryStatus(id, status);
        listings = listings.map((v) => (v.id === id ? { ...v, posted_status: status } : v));
        toast(`Status: ${listingStatusLabel(status)}`);
        paint();
      } catch (err: any) {
        setMsg(err?.message || 'Could not save status');
      }
    })();
  });

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const post = t.closest('[data-inv-post]') as HTMLElement | null;
    const mark = t.closest('[data-inv-mark-posted]') as HTMLElement | null;
    if (mark?.dataset.invMarkPosted) {
      const id = mark.dataset.invMarkPosted;
      void setInventoryStatus(id, 'posted')
        .then(() => { listings = listings.map((v) => (v.id === id ? { ...v, posted_status: 'posted' } : v)); paint(); toast('Marked Posted'); })
        .catch((err) => setMsg(err?.message || 'Could not mark posted'));
      return;
    }
    if (!post?.dataset.invPost) return;
    const vehicle = listings.find((v) => v.id === post.dataset.invPost);
    if (!vehicle) return;
    const ready = assessListingReadiness(vehicle);
    if (!ready.canInject) { setMsg(`Blocked: ${ready.summary}`); return; }
    void (async () => {
      try {
        if (isApiBackedInventoryId(vehicle.id) && normalizeListingStatus(vehicle.posted_status) === 'not_posted') {
          await setInventoryStatus(vehicle.id, 'pending').catch(() => undefined);
          vehicle.posted_status = 'pending';
        }
        const payload = {
          type: 'BREVMONT_MARKETPLACE_START_POST',
          vehicle: {
            id: vehicle.id,
            title: listingHeadline(vehicle),
            year: vehicle.year ?? null,
            make: vehicle.make ?? null,
            model: vehicle.model ?? null,
            trim: vehicle.trim ?? null,
            price: vehicle.total_price ?? vehicle.price ?? null,
            mileage: vehicle.mileage ?? null,
            vin: vehicle.vin ?? null,
            stock_number: vehicle.stock_number ?? null,
            description: vehicle.description ?? null,
            photos: (vehicle.photos || []).filter(Boolean),
            vdp_url: vehicle.vdp_url ?? vehicle.source_url ?? null,
            exterior_color: vehicle.exterior_color ?? null,
            interior_color: vehicle.interior_color ?? null,
            body_style: vehicle.body_style ?? null,
            location: vehicle.location ?? null,
            condition: vehicle.condition ?? null,
          },
          marketplace_phone: '',
          autofill: 'exploratory_stub',
        };
        chrome.runtime.sendMessage(payload, (resp) => {
          const err = chrome.runtime.lastError;
          setMsg(err
            ? 'Could not reach the extension background.'
            : (resp?.ok
              ? 'Create tab opened. Confirm fields, then publish yourself. Mark Posted when the listing is live.'
              : (resp?.error || 'Handoff failed')));
          paint();
        });
      } catch (err: any) {
        setMsg(err?.message || 'Post handoff failed');
      }
    })();
  });

  return {
    overlay,
    body,
    openList: async () => {
      overlay.style.display = 'flex';
      if (poll) window.clearInterval(poll);
      poll = window.setInterval(() => void load(true), POLL_MS);
      await load(false);
    },
    openScan,
  };
}
