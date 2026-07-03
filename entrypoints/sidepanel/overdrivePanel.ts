/**
 * Overdrive sidepanel UI — self-contained.
 *
 * Mounts into a caller-provided DOM node. Handles the full rep flow:
 *   Link Facebook → Disclosure → Photo → Toggle ON.
 *
 * Vanilla TS to match sidepanel/main.ts style; no React.
 */

import {
  getOverdriveSettings,
  patchOverdriveSettings,
  postLinkFacebook,
  postUnlinkFacebook,
  postDisclosureAck,
  postRepPhoto,
} from '../lib/overdrive/apiClient';

interface OverdrivePanelState {
  loading: boolean;
  error: string | null;
  data: Awaited<ReturnType<typeof getOverdriveSettings>> | null;
}

const DISCLOSURE_TEXT = [
  'What Overdrive reads:',
  '- Marketplace/Messenger threads only, on facebook.com/messenger.com only.',
  '- Buyer name, vehicle listing, and thread history of qualified conversations.',
  '',
  'What Overdrive sends:',
  '- One reply per inbound, driving toward an in-store appointment.',
  '- A thumbs-up selfie only if the customer asks if you are a bot.',
  '- Never negotiates prices or trade values. Never quotes rates.',
  '',
  'What your GM sees:',
  '- Every autonomous message on the manager dashboard live feed.',
  '- Escalations, appointment sets, and any send that failed verification.',
  '',
  'Overdrive works only while Chrome is open with a Facebook tab available.',
].join('\n');

/**
 * Renders the panel into `container`. Reruns the fetch on every mount
 * so the UI reflects current state.
 */
export async function renderOverdrivePanel(container: HTMLElement): Promise<void> {
  const state: OverdrivePanelState = { loading: true, error: null, data: null };

  const paint = () => {
    if (state.loading) {
      container.innerHTML = `<div class="overdrive-panel"><div class="overdrive-header">Overdrive</div><div class="overdrive-body">Loading…</div></div>`;
      return;
    }
    if (state.error) {
      container.innerHTML = `<div class="overdrive-panel"><div class="overdrive-header">Overdrive</div><div class="overdrive-body overdrive-error">${escapeHtml(state.error)}</div><div class="overdrive-actions"><button data-action="reload">Retry</button></div></div>`;
      wireEvents(container, state, paint);
      return;
    }
    container.innerHTML = renderPanelHTML(state.data);
    wireEvents(container, state, paint);
  };

  paint();
  try {
    state.data = await getOverdriveSettings();
    state.loading = false;
    paint();
  } catch (err: any) {
    state.loading = false;
    state.error = err?.message || 'Could not load Overdrive settings.';
    paint();
  }
}

function renderPanelHTML(data: OverdrivePanelState['data']): string {
  if (!data) return '';
  const linked = data.linked.facebook;
  const disclosureAcked = !!data.linked.disclosure_ack_at;
  const hasPhoto = !!data.linked.rep_photo_url;
  const enabled = !!data.settings?.enabled;
  const dealerOff = !data.dealership_enabled;

  const steps = [
    { key: 'link', label: 'Link Facebook', done: linked, current: !linked },
    { key: 'disclosure', label: 'Review + acknowledge', done: disclosureAcked, current: linked && !disclosureAcked },
    { key: 'photo', label: 'Upload thumbs-up selfie', done: hasPhoto, current: linked && disclosureAcked && !hasPhoto },
    { key: 'toggle', label: 'Turn Overdrive ON', done: enabled, current: linked && disclosureAcked && hasPhoto && !enabled },
  ];

  const dealerBanner = dealerOff
    ? `<div class="overdrive-banner">Your GM has Overdrive disabled at the dealership. Ask them to enable it in Manager Settings.</div>`
    : '';

  const activeStatus = enabled
    ? `<div class="overdrive-status overdrive-status-on">Overdrive is ON — active hours ${data.settings?.active_hours_start ?? 7}:00 – ${data.settings?.active_hours_end ?? 22}:00</div>`
    : `<div class="overdrive-status overdrive-status-off">Overdrive is OFF</div>`;

  const stepsHTML = steps
    .map(
      (s) => `
    <div class="overdrive-step ${s.done ? 'done' : ''} ${s.current ? 'current' : ''}">
      <span class="overdrive-step-check">${s.done ? '✓' : s.current ? '●' : '○'}</span>
      <span class="overdrive-step-label">${escapeHtml(s.label)}</span>
      ${s.current ? renderActionForStep(s.key, data) : ''}
    </div>`
    )
    .join('');

  const linkedInfo = linked
    ? `<div class="overdrive-linked">Linked: <strong>${escapeHtml(data.linked.facebook_profile_name || '')}</strong> · <a href="#" data-action="unlink">Unlink</a></div>`
    : '';

  const toggleControl = enabled
    ? `<button class="overdrive-btn overdrive-btn-secondary" data-action="disable">Turn Overdrive OFF</button>`
    : linked && disclosureAcked && hasPhoto && !dealerOff
      ? `<button class="overdrive-btn overdrive-btn-primary" data-action="enable">Turn Overdrive ON</button>`
      : '';

  return `
    <div class="overdrive-panel">
      <style>${STYLES}</style>
      <div class="overdrive-header">
        <span class="overdrive-title">Overdrive</span>
        <span class="overdrive-subtitle">Answers Marketplace inquiries for you</span>
      </div>
      ${dealerBanner}
      ${activeStatus}
      ${linkedInfo}
      <div class="overdrive-steps">${stepsHTML}</div>
      <div class="overdrive-toggle-row">${toggleControl}</div>
    </div>
    <div id="overdrive-modal-root"></div>
  `;
}

function renderActionForStep(key: string, data: OverdrivePanelState['data']): string {
  if (key === 'link') {
    return `<button class="overdrive-btn overdrive-btn-primary" data-action="link-fb">Link Personal Facebook</button>`;
  }
  if (key === 'disclosure') {
    return `<button class="overdrive-btn overdrive-btn-primary" data-action="show-disclosure">Read + Acknowledge</button>`;
  }
  if (key === 'photo') {
    return `<label class="overdrive-btn overdrive-btn-primary"><input type="file" accept="image/*" data-action="photo-file" style="display:none">Upload Thumbs-Up Selfie</label>`;
  }
  return '';
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wireEvents(container: HTMLElement, state: OverdrivePanelState, paint: () => void): void {
  const reload = async () => {
    state.loading = true;
    state.error = null;
    paint();
    try {
      state.data = await getOverdriveSettings();
      state.loading = false;
      state.error = null;
    } catch (err: any) {
      state.loading = false;
      state.error = err?.message || 'Failed to reload';
    }
    paint();
  };

  container.querySelector('[data-action="reload"]')?.addEventListener('click', () => void reload());

  container.querySelector('[data-action="link-fb"]')?.addEventListener('click', async () => {
    await runLinkFacebookFlow(container, reload);
  });

  container.querySelector('[data-action="show-disclosure"]')?.addEventListener('click', () => {
    showDisclosureModal(container, reload);
  });

  const photoInput = container.querySelector('[data-action="photo-file"]') as HTMLInputElement | null;
  if (photoInput) {
    photoInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await runPhotoUploadFlow(file, container, reload);
    });
  }

  container.querySelector('[data-action="enable"]')?.addEventListener('click', async () => {
    try {
      await patchOverdriveSettings({ enabled: true } as any);
      // Notify background to refresh cached settings.
      try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
      await reload();
    } catch (err: any) {
      alert(`Could not turn Overdrive on: ${err?.message || 'unknown error'}`);
    }
  });

  container.querySelector('[data-action="disable"]')?.addEventListener('click', async () => {
    if (!confirm('Turn Overdrive OFF? You can turn it back on anytime.')) return;
    try {
      await patchOverdriveSettings({ enabled: false } as any);
      try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
      await reload();
    } catch (err: any) {
      alert(`Could not turn Overdrive off: ${err?.message || 'unknown error'}`);
    }
  });

  container.querySelector('[data-action="unlink"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Unlink Facebook? This also turns Overdrive off.')) return;
    try {
      await postUnlinkFacebook();
      try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
      await reload();
    } catch (err: any) {
      alert(`Unlink failed: ${err?.message || 'unknown error'}`);
    }
  });
}

/**
 * Link Facebook flow — opens FB, waits for load, asks content script
 * to scrape, confirms, POSTs to server.
 */
async function runLinkFacebookFlow(container: HTMLElement, reload: () => Promise<void>): Promise<void> {
  container.querySelector('.overdrive-body')?.remove();
  // Open (or find) a facebook.com tab and focus it.
  let tabId: number | null = null;
  const existing = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ url: ['*://*.facebook.com/*'] }, (t) => resolve(t || []));
  });
  if (existing.length > 0 && existing[0].id) {
    tabId = existing[0].id;
    try { chrome.tabs.update(tabId, { active: true }); } catch { /* noop */ }
  } else {
    const created = await new Promise<chrome.tabs.Tab | null>((resolve) => {
      try {
        chrome.tabs.create({ url: 'https://www.facebook.com/', active: true }, (t) => resolve(t));
      } catch {
        resolve(null);
      }
    });
    tabId = created?.id || null;
  }
  if (!tabId) {
    alert('Could not open Facebook. Please open facebook.com manually and try again.');
    return;
  }

  // Wait up to 15 seconds for the tab to load, then send the scrape
  // request. The content script's OVERDRIVE_SCRAPE_FB_PROFILE handler
  // returns { ok, scrape: { profile_name, profile_url, avatar_url } }
  // or an error.
  const scrapeResult = await pollScrape(tabId, 15000);
  if (!scrapeResult?.ok || !scrapeResult.scrape) {
    alert(
      `Could not detect your logged-in Facebook profile.\n\n` +
      `Please make sure you are signed in at facebook.com, then click Link Personal Facebook again.\n\n` +
      `Details: ${scrapeResult?.error || 'no_scrape'}`
    );
    return;
  }

  const scrape = scrapeResult.scrape;
  const ok = confirm(
    `Link ${scrape.profile_name}'s Facebook to Overdrive?\n\n` +
    `Overdrive will only monitor Marketplace/Messenger threads on this profile.\n` +
    `You can unlink anytime from this panel.`
  );
  if (!ok) return;

  try {
    await postLinkFacebook(scrape);
    try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
    await reload();
  } catch (err: any) {
    alert(`Link failed: ${err?.message || 'unknown error'}`);
  }
}

async function pollScrape(
  tabId: number,
  maxMs: number
): Promise<{ ok: boolean; scrape?: any; error?: string } | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const res = await new Promise<{ ok: boolean; scrape?: any; error?: string } | null>((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'OVERDRIVE_SCRAPE_FB_PROFILE' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
    if (res?.ok && res.scrape) return res;
    if (res?.error && res.error !== 'no_logged_in_profile_detected') return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, error: 'timeout_waiting_for_scrape' };
}

function showDisclosureModal(container: HTMLElement, reload: () => Promise<void>): void {
  const modal = document.createElement('div');
  modal.className = 'overdrive-modal';
  modal.innerHTML = `
    <div class="overdrive-modal-panel">
      <h2>Overdrive Disclosure</h2>
      <pre class="overdrive-disclosure-text">${escapeHtml(DISCLOSURE_TEXT)}</pre>
      <div class="overdrive-modal-actions">
        <button class="overdrive-btn overdrive-btn-secondary" data-modal-action="cancel">Cancel</button>
        <button class="overdrive-btn overdrive-btn-primary" data-modal-action="ack">I understand — acknowledge</button>
      </div>
    </div>
  `;
  container.appendChild(modal);

  modal.querySelector('[data-modal-action="cancel"]')?.addEventListener('click', () => modal.remove());
  modal.querySelector('[data-modal-action="ack"]')?.addEventListener('click', async () => {
    try {
      await postDisclosureAck('2026-07-02.v1');
      try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
      modal.remove();
      await reload();
    } catch (err: any) {
      alert(`Could not save acknowledgement: ${err?.message || 'unknown'}`);
    }
  });
}

async function runPhotoUploadFlow(file: File, container: HTMLElement, reload: () => Promise<void>): Promise<void> {
  if (file.size > 512 * 1024) {
    alert(`Photo too large (${Math.round(file.size / 1024)} KB). Please pick something under 512 KB.`);
    return;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read_failed'));
    r.readAsDataURL(file);
  });
  try {
    await postRepPhoto(dataUrl);
    try { chrome.runtime.sendMessage({ type: 'OVERDRIVE_REFRESH_SETTINGS' }); } catch { /* noop */ }
    await reload();
  } catch (err: any) {
    alert(`Photo upload failed: ${err?.message || 'unknown'}`);
  }
}

const STYLES = `
.overdrive-panel { font: 13px system-ui, -apple-system, sans-serif; padding: 16px; background: #F8F6F1; border-radius: 12px; margin: 12px 0; }
.overdrive-header { display: flex; flex-direction: column; margin-bottom: 12px; }
.overdrive-title { font-size: 18px; font-weight: 700; color: #0F1419; }
.overdrive-subtitle { font-size: 12px; color: rgba(15,20,25,0.55); margin-top: 2px; }
.overdrive-banner { background: #FEE2E2; color: #7F1D1D; padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 10px; }
.overdrive-status { padding: 8px 12px; border-radius: 8px; font-weight: 600; font-size: 12px; margin-bottom: 12px; }
.overdrive-status-on { background: #DCFCE7; color: #14532D; }
.overdrive-status-off { background: #E5E7EB; color: #374151; }
.overdrive-linked { font-size: 12px; color: rgba(15,20,25,0.65); margin-bottom: 12px; }
.overdrive-linked a { color: #B91C1C; text-decoration: underline; }
.overdrive-steps { display: flex; flex-direction: column; gap: 8px; }
.overdrive-step { display: flex; align-items: center; gap: 10px; padding: 8px; background: white; border-radius: 8px; }
.overdrive-step-check { width: 20px; text-align: center; color: rgba(15,20,25,0.4); }
.overdrive-step.done .overdrive-step-check { color: #14532D; font-weight: 700; }
.overdrive-step.current .overdrive-step-check { color: #0D6E6E; }
.overdrive-step.done .overdrive-step-label { color: rgba(15,20,25,0.4); text-decoration: line-through; }
.overdrive-btn { margin-left: auto; padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; }
.overdrive-btn-primary { background: #0D6E6E; color: white; }
.overdrive-btn-secondary { background: #E5E7EB; color: #0F1419; }
.overdrive-toggle-row { margin-top: 12px; text-align: right; }
.overdrive-error { background: #FEE2E2; color: #7F1D1D; padding: 8px; border-radius: 8px; }
.overdrive-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; }
.overdrive-modal-panel { background: white; border-radius: 12px; padding: 24px; max-width: 480px; width: 100%; }
.overdrive-modal-panel h2 { margin: 0 0 12px; font-size: 16px; }
.overdrive-disclosure-text { white-space: pre-wrap; font: 12px monospace; background: #F8F6F1; padding: 12px; border-radius: 8px; max-height: 300px; overflow-y: auto; }
.overdrive-modal-actions { margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end; }
`;
