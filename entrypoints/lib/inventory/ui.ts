/**
 * Inventory UI for the side panel.
 *
 * Mounts a self-contained dropdown popover under the header "Inventory ▾"
 * button (o8-inventory-btn, added in panelUI.ts). The dropdown offers:
 *   [Add Inventory] [View Inventory] [Delete Inventory]
 *
 * ADD  → on a detected dealer site, a big "Scan Inventory" button + progress;
 *        otherwise a helper message. Scan uses the MAIN-world reader (Dealer.com
 *        window.DDC.dataLayer.vehicles) and POSTs to /api/v1/rep/inventory/scan.
 * VIEW → opens the app hub inventory screen in a new tab.
 * DELETE → opens the app hub (delete lives there in Phase 1).
 *
 * HARD RULE: Phase 1 is read-only scraping of the rep's OWN dealer site. Zero
 * Facebook interaction, no auto-submit anywhere.
 */

import { detectInventorySite } from './scrape';
import { detectLivePage } from './mainWorldReader';
import { scanInventory, type ScanProgress } from './scanRunner';
import { postInventoryScan } from './apiClient';

const HUB_BASE_DEFAULT = 'https://app.brevmont.com';
const HUB_INVENTORY_PATH = '/rep/app/inventory';

async function hubInventoryUrl(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['app_base_url']);
    const base = (cfg?.app_base_url as string) || HUB_BASE_DEFAULT;
    return `${base.replace(/\/$/, '')}${HUB_INVENTORY_PATH}`;
  } catch {
    return `${HUB_BASE_DEFAULT}${HUB_INVENTORY_PATH}`;
  }
}

async function activeTabId(): Promise<number> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof tab?.id === 'number' ? tab.id : -1;
  } catch {
    return -1;
  }
}

function openHub(): void {
  void hubInventoryUrl().then((url) => {
    try { chrome.tabs.create({ url, active: true }); } catch { /* noop */ }
  });
}

/** Idempotently create the dropdown + scan overlay and wire the header button. */
export function wireInventory(root: HTMLElement, toast: (msg: string) => void): void {
  const btn = root.querySelector('#o8-inventory-btn') as HTMLButtonElement | null;
  if (!btn) return;
  // Element-scoped guard: safe even if wireHandlers runs again on a fresh DOM.
  if (btn.dataset.invWired === '1') return;
  btn.dataset.invWired = '1';

  // Remove any stale singletons from a prior panel render.
  document.getElementById('o8-inventory-dropdown')?.remove();
  document.getElementById('o8-inventory-scan')?.remove();

  // ── Dropdown ──────────────────────────────────────────────────────────
  const dropdown = document.createElement('div');
  dropdown.id = 'o8-inventory-dropdown';
  dropdown.className = 'inv-dropdown';
  dropdown.style.display = 'none';
  dropdown.innerHTML = `
    <button class="inv-dropdown-item" data-inv-action="add" type="button">Add Inventory</button>
    <button class="inv-dropdown-item" data-inv-action="view" type="button">View Inventory</button>
    <button class="inv-dropdown-item" data-inv-action="delete" type="button">Delete Inventory</button>
  `;
  document.body.appendChild(dropdown);

  // ── Scan overlay ─────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'o8-inventory-scan';
  overlay.className = 'inv-scan-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="inv-scan-card">
      <div class="inv-scan-head">
        <span class="inv-scan-title">Add Inventory</span>
        <button class="inv-scan-close" id="o8-inv-scan-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="inv-scan-body" id="o8-inv-scan-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('#o8-inv-scan-body') as HTMLElement;
  (overlay.querySelector('#o8-inv-scan-close') as HTMLButtonElement).onclick = () => {
    overlay.style.display = 'none';
  };

  const closeDropdown = (): void => { dropdown.style.display = 'none'; };

  const positionDropdown = (): void => {
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${Math.round(rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.round(rect.left)}px`;
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen) { closeDropdown(); return; }
    positionDropdown();
    dropdown.style.display = 'block';
  };

  document.addEventListener('click', (e) => {
    if (dropdown.style.display === 'none') return;
    if (e.target === btn || dropdown.contains(e.target as Node)) return;
    closeDropdown();
  });

  dropdown.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-inv-action]') as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute('data-inv-action');
    closeDropdown();
    if (action === 'view') { openHub(); return; }
    if (action === 'delete') { openHub(); return; }
    if (action === 'add') { void openAddView(); }
  });

  // ── ADD view ─────────────────────────────────────────────────────────
  async function openAddView(): Promise<void> {
    overlay.style.display = 'flex';
    body.innerHTML = '<div class="inv-scan-hint">Checking this page…</div>';

    const tabId = await activeTabId();
    if (tabId < 0) {
      body.innerHTML = '<div class="inv-scan-hint">Open your dealership\'s used-inventory page in this tab, then reopen Add Inventory.</div>';
      return;
    }

    const sig = await detectLivePage(tabId);
    const detected = detectInventorySite({
      hasPlatformDataLayer: sig.hasPlatformDataLayer,
      jsonLdVehicleCount: sig.jsonLdVehicleCount,
      vehicleCardCount: sig.vehicleCardCount,
      url: sig.url,
    });

    if (!detected) {
      body.innerHTML = `
        <div class="inv-scan-hint">This doesn't look like a dealership inventory page.</div>
        <div class="inv-scan-help">Go to your dealership's used-inventory page (the grid of cars), then click Scan.</div>
      `;
      return;
    }

    body.innerHTML = `
      <button class="inv-scan-btn" id="o8-inv-scan-go" type="button">Scan Inventory</button>
      <div class="inv-scan-help">Go to your dealership's used-inventory page, then click Scan. Brevmont reads the cars on the page — nothing is posted anywhere.</div>
      <div class="inv-scan-progress" id="o8-inv-scan-progress" style="display:none"></div>
    `;

    const go = body.querySelector('#o8-inv-scan-go') as HTMLButtonElement;
    const progress = body.querySelector('#o8-inv-scan-progress') as HTMLElement;
    go.onclick = () => { void runScan(tabId, go, progress); };
  }

  async function runScan(tabId: number, go: HTMLButtonElement, progress: HTMLElement): Promise<void> {
    go.disabled = true;
    go.textContent = 'Scanning…';
    progress.style.display = 'block';
    const onProgress = (p: ScanProgress): void => { progress.textContent = p.message; };

    try {
      const result = await scanInventory(tabId, onProgress);
      if (!result.detected || result.vehicles.length === 0) {
        progress.textContent = 'No vehicles found on this page.';
        go.disabled = false;
        go.textContent = 'Scan Inventory';
        return;
      }
      progress.textContent = `Sending ${result.vehicles.length} vehicles…`;
      const resp = await postInventoryScan(result.vehicles, result.sourceUrl);
      progress.innerHTML = `
        <div class="inv-scan-done">Saved ${resp.seen} vehicles to your inventory.</div>
        <button class="inv-scan-btn secondary" id="o8-inv-view-hub" type="button">View Inventory</button>
      `;
      const viewHub = progress.querySelector('#o8-inv-view-hub') as HTMLButtonElement | null;
      if (viewHub) viewHub.onclick = () => openHub();
      go.style.display = 'none';
      toast(`Inventory updated — ${resp.seen} vehicles`);
    } catch (err: any) {
      const status = err?.status;
      const msg = status === 401 || status === 403
        ? 'Please sign in to Brevmont, then scan again.'
        : `Could not save inventory: ${err?.message || 'unknown error'}. Try again.`;
      progress.textContent = msg;
      go.disabled = false;
      go.textContent = 'Scan Inventory';
    }
  }
}
