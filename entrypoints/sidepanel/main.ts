/**
 * Brevmont Side Panel — main entry point.
 *
 * Runs inside Chrome's native Side Panel (browser chrome, NOT the host page).
 * Communicates with content scripts via chrome.runtime message passing through
 * the background service worker.
 *
 * Phase 1: shell bootstrap + message bridge skeleton.
 * Phase 2: full panel UI extracted from content.ts getHTML/getCSS.
 */

import { getPanelHTML } from '../lib/panelUI';
import { getPanelCSS } from '../lib/panelCSS';
import { clearJwtCache } from '../../lib/jwtCache';
import { clearAuth } from '../../lib/storage';
import { getFeatureAccess } from '../../lib/featureGate';

// ─── Types ───────────────────────────────────────────────────────────────────
type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

interface PlatformContext {
  platform: Platform;
  tabId: number;
  url: string;
}

interface VersionStatus {
  locked?: boolean;
  deprecated?: boolean;
  updateRequired?: boolean;
  forceUpdate?: boolean;
  message?: string | null;
  latest?: string | null;
  downloadUrl?: string | null;
}

// ─── State ───────────────────────────────────────────────────────────────────
let currentPlatform: PlatformContext = { platform: 'unknown', tabId: -1, url: '' };
let isGenerating = false;
const FIRST_GENERATION_KEY = 'first_generation_completed';
const FIRST_GENERATION_EXAMPLE = 'Follow up with John about the Silverado, he wanted to think about the payment';

const AUTH_SYNC_KEYS = [
  'license_key',
  'license_secret',
  'brevmont_license_secret',
  'dealer_token',
  'rep_auth_token',
  'brevmont_rep_auth_token',
  'rep_id',
  'rep_name',
  'dealership_id',
  'dealership',
  'profile_onboarded',
  'profile',
  'install_token',
  'brevmont_tier',
  'dealership_tier',
  'dealership_plan',
];

async function clearCredentialsForReconnect(): Promise<void> {
  await Promise.allSettled([
    clearJwtCache(),
    clearAuth(),
    chrome.storage.sync.remove(AUTH_SYNC_KEYS),
    chrome.storage.local.remove([
      'license_revoked',
      'license_revoked_at',
      'license_revoked_message',
      'brevmont_jwt_cache',
      'brevmont_tier',
      'dealership_tier',
      'dealership_plan',
      'brevmont_features',
      'brevmont_usage',
    ]),
  ]);
}

// ─── Platform detection from URL (no DOM access needed) ──────────────────────
function detectPlatformFromURL(url: string): Platform {
  if (!url) return 'unknown';
  if (url.includes('vinsolutions') || url.includes('coxautoinc')) return 'vinsolutions';
  if (url.includes('mail.google.com')) return 'gmail';
  if (url.includes('messenger.com') || url.includes('facebook.com/messages') || url.includes('facebook.com/marketplace/t/')) return 'facebook';
  if (url.includes('facebook.com')) return 'unknown';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('instagram.com/direct')) return 'instagram';
  if (url.includes('instagram.com')) return 'unknown';
  if (url.includes('web.whatsapp.com')) return 'whatsapp';
  return 'unknown';
}

// ─── Badge config per platform (matches content.ts getBadge) ─────────────────
function getBadge(platform: Platform) {
  switch (platform) {
    case 'vinsolutions': return { label: 'Dealer CRM', color: '#0D6E6E', bg: '#F0EFFF' };
    case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
    case 'facebook': return { label: 'Messenger', color: '#1877f2', bg: '#eff6ff' };
    case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
    case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
    case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
    default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
  }
}

// ─── Escape HTML ─────────────────────────────────────────────────────────────
function esc(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Send message to background and get response ─────────────────────────────
// 30-second timeout ensures the user always gets feedback, even if the MV3
// service worker is killed mid-flight.
function safeSend(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timed out — please try again.'));
    }, 30_000);

    chrome.runtime.sendMessage(msg, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Message send failed'));
        return;
      }
      // Chrome auto-completes the channel with undefined when the background
      // handler never calls sendResponse (e.g., service worker restart).
      if (response === undefined || response === null) {
        reject(new Error('No response from background — try again.'));
        return;
      }
      // Surface API errors instead of silently swallowing them.
      // Background handlers send { error: '...' } when the API fails.
      if (response?.error && typeof response.error === 'string') {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

// ─── Token check helper — avoids sending API calls destined to 401 ──────────
function accessEndedMessage(message?: string): string {
  return message || 'Your access at this dealership has ended. Been invited to a new store? Open Settings and reconnect.';
}

async function requireToken(): Promise<string> {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(['dealer_token', 'rep_auth_token']),
    chrome.storage.local.get(['dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token', 'license_revoked', 'license_revoked_message']),
  ]);
  if (local.license_revoked) {
    throw new Error(accessEndedMessage(local.license_revoked_message as string | undefined));
  }
  const token = (
    sync.dealer_token ||
    local.dealer_token ||
    sync.rep_auth_token ||
    local.rep_auth_token ||
    local.brevmont_rep_auth_token ||
    ''
  ) as string;
  if (!token) throw new Error('Brevmont is not activated. Open Settings and activate your rep account.');
  return token;
}

// ─── Send message to content script in active tab ────────────────────────────
async function sendToContent(msg: any): Promise<any> {
  if (currentPlatform.tabId < 0) return null;
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentPlatform.tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Content message failed'));
        return;
      }
      resolve(response);
    });
  });
}

// ─── Detect active tab platform ─────────────────────────────────────────────
async function refreshPlatform(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.id) {
      const platform = detectPlatformFromURL(tab.url);
      currentPlatform = { platform, tabId: tab.id, url: tab.url };
    } else {
      currentPlatform = { platform: 'unknown', tabId: -1, url: '' };
    }
  } catch {
    currentPlatform = { platform: 'unknown', tabId: -1, url: '' };
  }
}

// ─── Free tier usage counter ────────────────────────────────────────────────
function updateUsageCounter(root: HTMLElement): void {
  chrome.storage.local.get(['brevmont_tier', 'brevmont_usage']).then(data => {
    const counter = root.querySelector('#o8-usage-counter') as HTMLElement;
    if (!counter) return;

    const tier = data.brevmont_tier || '';
    const usage = data.brevmont_usage as { generations_used?: number; generations_limit?: number; generations_remaining?: number } | undefined;

    // Only show counter for free tier
    if (tier !== 'free' || !usage) {
      counter.style.display = 'none';
      return;
    }

    const used = usage.generations_used || 0;
    const limit = usage.generations_limit || 500;
    const remaining = Math.max(0, limit - used);
    const pct = Math.min(100, Math.round((used / limit) * 100));

    counter.style.display = 'block';
    counter.className = 'usage-counter' + (pct >= 90 ? ' usage-critical' : pct >= 70 ? ' usage-warning' : '');
    counter.innerHTML = `<span>${used}/${limit} free follow-ups used this month</span><div class="usage-bar"><div class="usage-fill" style="width:${pct}%"></div></div>`;
  }).catch(() => {});
}

function showUpgradePrompt(root: HTMLElement, message: string, upgradeUrl?: string): void {
  const prompt = root.querySelector('#o8-upgrade-prompt') as HTMLElement;
  if (!prompt) return;
  prompt.style.display = 'block';
  prompt.innerHTML = `
    <div class="upgrade-title">Free follow-ups used up</div>
    <div class="upgrade-msg">${esc(message)}</div>
    <a class="upgrade-btn" href="${upgradeUrl || 'https://brevmont.com'}" target="_blank">Text us about more access</a>
    <div class="upgrade-phone">Or text us: 307-690-0291</div>
  `;
}

function normalizeVersionStatus(raw: unknown): VersionStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as VersionStatus;
  const forceUpdate = Boolean(value.forceUpdate || value.locked);
  const updateRequired = Boolean(value.updateRequired || value.deprecated || forceUpdate);
  if (!updateRequired && !forceUpdate) return null;
  return {
    ...value,
    updateRequired,
    forceUpdate,
    message: value.message || (forceUpdate ? 'Please update Brevmont to continue.' : 'A new version of Brevmont is available.'),
    downloadUrl: value.downloadUrl || 'https://api.brevmont.com/api/extension-download',
  };
}

async function getVersionStatus(): Promise<VersionStatus | null> {
  const data = await chrome.storage.local.get('brevmont_version_status');
  return normalizeVersionStatus(data.brevmont_version_status);
}

async function applyVersionStatus(root: HTMLElement): Promise<void> {
  const existing = root.querySelector('#o8-version-update-banner');
  if (existing) existing.remove();

  const status = await getVersionStatus();
  if (!status) return;

  const banner = document.createElement('div');
  banner.id = 'o8-version-update-banner';
  banner.className = `version-update-banner${status.forceUpdate ? ' force' : ''}`;
  banner.innerHTML = `
    <div class="version-update-title">${status.forceUpdate ? 'Update required' : 'Update available'}</div>
    <div class="version-update-copy">${esc(status.message || '')}</div>
    <button id="o8-version-download" class="version-update-btn" type="button">Download latest${status.latest ? ` v${esc(String(status.latest))}` : ''}</button>
  `;

  const header = root.querySelector('.header');
  if (header) header.insertAdjacentElement('afterend', banner);
  else root.prepend(banner);

  const download = banner.querySelector('#o8-version-download') as HTMLButtonElement | null;
  if (download) {
    download.onclick = () => chrome.tabs.create({ url: status.downloadUrl || 'https://api.brevmont.com/api/extension-download' });
  }

  if (status.forceUpdate) {
    root.querySelectorAll<HTMLButtonElement>('#o8-generate,#o8-coach-btn,#o8-cmd-execute,#o8-ctx-generate').forEach((button) => {
      button.disabled = true;
      button.title = 'Update Brevmont to keep writing follow-ups.';
    });
  }
}

async function ensureGenerationAllowed(root: HTMLElement): Promise<boolean> {
  const status = await getVersionStatus();
  if (!status?.forceUpdate) return true;
  await applyVersionStatus(root);
  showToast(root, 'Update Brevmont to keep writing follow-ups.');
  return false;
}

// ─── Build panel DOM ─────────────────────────────────────────────────────────
function setDisplay(root: HTMLElement, selector: string, visible: boolean): void {
  const node = root.querySelector(selector) as HTMLElement | null;
  if (node) node.style.display = visible ? '' : 'none';
}

function applyFeatureGates(root: HTMLElement): void {
  getFeatureAccess().then(access => {
    setDisplay(root, '#o8-lead-btn', access.addLead);
    setDisplay(root, '#o8-lead-panel', access.addLead);
    setDisplay(root, '#o8-outcome-section', access.markOutcome);
    setDisplay(root, '.inline-links', access.coachMe || access.stats || access.settings);
    setDisplay(root, '#o8-tools-btn-inline', access.coachMe);
    setDisplay(root, '#o8-tools-panel', access.coachMe || access.notifications || access.screenshotCapture || access.commandMode);
    setDisplay(root, '#o8-stats-btn-inline', access.stats);
    setDisplay(root, '#o8-stats-panel', access.stats);
    setDisplay(root, '#o8-settings-btn-inline', access.settings);
    setDisplay(root, '#o8-settings-panel', access.settings);

    const gates = [
      { tab: '[data-tool="coach"]', content: '#tool-coach', allowed: access.coachMe },
      { tab: '[data-tool="alerts"]', content: '#tool-alerts', allowed: access.notifications },
      { tab: '[data-tool="context"]', content: '#tool-context', allowed: access.screenshotCapture },
      { tab: '[data-tool="command"]', content: '#tool-command', allowed: access.commandMode },
    ];

    for (const gate of gates) {
      setDisplay(root, gate.tab, gate.allowed);
      setDisplay(root, gate.content, gate.allowed);
    }

    if (!access.coachMe && !access.notifications && !access.screenshotCapture && !access.commandMode) {
      const toolsPanel = root.querySelector('#o8-tools-panel') as HTMLElement | null;
      if (toolsPanel) toolsPanel.style.display = 'none';
    }
  }).catch(() => {
    for (const selector of [
      '#o8-lead-btn',
      '#o8-lead-panel',
      '#o8-outcome-section',
      '.inline-links',
      '#o8-tools-panel',
      '#o8-stats-panel',
      '#o8-settings-panel',
      '[data-tool="coach"]',
      '[data-tool="alerts"]',
      '[data-tool="context"]',
      '[data-tool="command"]',
      '#tool-coach',
      '#tool-alerts',
      '#tool-context',
      '#tool-command',
    ]) {
      setDisplay(root, selector, false);
    }
  });
}

function renderPanel(): void {
  const root = document.getElementById('sp-root')!;
  const loading = document.getElementById('sp-loading');

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = getPanelCSS(currentPlatform.platform);
  document.head.appendChild(style);

  // Inject HTML
  root.innerHTML = getPanelHTML(currentPlatform.platform);

  // Hide loading, show panel
  if (loading) loading.style.display = 'none';
  root.style.display = 'block';

  // Wire event handlers
  wireHandlers(root);

  // Show free tier usage counter if applicable
  applyFirstUseGuide(root);
  updateUsageCounter(root);
  applyFeatureGates(root);
  showAccessEndedBanner(root);
  applyVersionStatus(root).catch(() => {});
}

async function applyFirstUseGuide(root: HTMLElement): Promise<void> {
  const card = root.querySelector('#o8-first-use') as HTMLElement | null;
  const input = root.querySelector('#o8-input') as HTMLTextAreaElement | null;
  if (!card) return;

  const state = await chrome.storage.local.get([FIRST_GENERATION_KEY, 'rep_name']);
  if (state[FIRST_GENERATION_KEY]) {
    card.style.display = 'none';
    return;
  }

  const repName = String(state.rep_name || '').trim();
  card.style.display = 'block';
  const title = card.querySelector('.first-use-title') as HTMLElement | null;
  if (title && repName) title.textContent = `Welcome, ${repName}. Try your first follow-up.`;
  if (input && !input.value.trim()) {
    input.placeholder = FIRST_GENERATION_EXAMPLE;
  }
}

async function markFirstGenerationComplete(root: HTMLElement): Promise<void> {
  await chrome.storage.local.set({ [FIRST_GENERATION_KEY]: true });
  const card = root.querySelector('#o8-first-use') as HTMLElement | null;
  if (!card) return;
  card.classList.add('done');
  card.style.display = 'block';
  card.innerHTML = `
    <div class="first-use-eyebrow">Nice.</div>
    <div class="first-use-title">That is your first follow-up.</div>
    <div class="first-use-copy">Your text, email, and CRM note are ready to review. Copy any of them into your CRM, text thread, or email. You decide what gets sent. Brevmont does the typing.</div>
  `;
  window.setTimeout(() => {
    card.style.display = 'none';
  }, 9000);
}

async function showAccessEndedBanner(root: HTMLElement): Promise<void> {
  const local = await chrome.storage.local.get(['license_revoked', 'license_revoked_message', 'dealership']);
  const existing = root.querySelector('#o8-access-ended-banner');
  if (existing) existing.remove();
  if (!local.license_revoked) return;

  const banner = document.createElement('div');
  banner.id = 'o8-access-ended-banner';
  banner.style.cssText = 'margin:8px 12px 0;padding:10px;border:1px solid #FCA5A5;border-radius:8px;background:#FEF2F2;color:#991B1B;font-size:12px;line-height:1.45;';
  banner.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">Access ended${local.dealership ? ` at ${esc(String(local.dealership))}` : ''}</div>
    <div>${esc(accessEndedMessage(local.license_revoked_message as string | undefined))}</div>
    <button id="o8-access-reconnect" style="margin-top:8px;border:0;border-radius:6px;background:#0D6E6E;color:#fff;font-size:12px;font-weight:700;padding:7px 10px;cursor:pointer;">Reconnect</button>
  `;
  const header = root.querySelector('.header');
  if (header) header.insertAdjacentElement('afterend', banner);
  else root.prepend(banner);

  const reconnect = banner.querySelector('#o8-access-reconnect') as HTMLButtonElement | null;
  if (reconnect) {
    reconnect.onclick = async () => {
      reconnect.disabled = true;
      reconnect.textContent = 'Opening setup...';
      await clearCredentialsForReconnect();
      chrome.runtime.sendMessage({ type: 'OPEN_ONBOARDING' }, () => {
        if (chrome.runtime.lastError) {
          try { chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }); } catch {}
        }
      });
    };
  }
}

// ─── Load account info into Settings panel (migrated from popup) ────────────
function loadAccountInfo(root: HTMLElement): void {
  const setText = (id: string, val: string) => { const e = root.querySelector(`#${id}`); if (e) e.textContent = val; };
  const maskToken = (t: string) => (!t || t.length < 8) ? (t || '—') : t.slice(0, 6) + '...' + t.slice(-4);

  // Version
  const manifest = chrome.runtime.getManifest();
  setText('sp-version', 'v' + (manifest.version || '?'));

  // Storage data
  chrome.storage.local.get(['rep_name', 'dealership', 'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']).then(local => {
    chrome.storage.sync.get(['rep_name', 'dealership', 'dealer_token']).then(sync => {
      setText('sp-dealership', (local.dealership || sync.dealership || 'Not configured') as string);
      setText('sp-rep-name', (local.rep_name || sync.rep_name || 'Not configured') as string);
      setText('sp-license', maskToken((local.dealer_token || sync.dealer_token || '') as string));
    });
  });

  // Queue size
  chrome.runtime.sendMessage({ type: 'GET_SYNC_QUEUE_COUNT' }).then((r: any) => {
    const count = typeof r?.count === 'number' ? r.count : 0;
    const row = root.querySelector('#sp-queue-row') as HTMLElement;
    if (row) { row.style.display = count > 0 ? 'block' : 'none'; }
    setText('sp-queue-count', String(count));
  }).catch(() => {});

  // Health check
  fetch('https://api.brevmont.com/health')
    .then(r => {
      const dot = root.querySelector('#sp-status-dot') as HTMLElement;
      const txt = root.querySelector('#sp-status-text') as HTMLElement;
      if (dot) dot.style.background = r.ok ? '#22C55E' : '#EF4444';
      if (txt) txt.textContent = r.ok ? 'Online' : 'Offline';
    })
    .catch(() => {
      const dot = root.querySelector('#sp-status-dot') as HTMLElement;
      const txt = root.querySelector('#sp-status-text') as HTMLElement;
      if (dot) dot.style.background = '#EF4444';
      if (txt) txt.textContent = 'Offline';
    });
}

// ─── Wire up all interactive elements ────────────────────────────────────────
function wireHandlers(root: HTMLElement): void {
  const el = (id: string) => root.querySelector(`#${id}`) as HTMLElement | null;

  // Version badge
  try {
    const vb = el('o8-version-badge');
    if (vb) {
      const v = chrome?.runtime?.getManifest?.()?.version || 'unknown';
      vb.textContent = `v${v}`;
    }
  } catch {}

  // Output chips — toggle selection
  root.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      const hasCards = root.querySelectorAll('.out-card').length > 0;
      if (hasCards) {
        setActiveOutputTab(root, c.getAttribute('data-type') || '');
      } else {
        c.classList.toggle('on');
      }
    });
  });

  // Generate button
  const genBtn = el('o8-generate');
  if (genBtn) genBtn.onclick = () => doGenerate(root);
  const exampleBtn = el('o8-first-use-example') as HTMLButtonElement | null;
  if (exampleBtn) {
    exampleBtn.onclick = () => {
      const input = el('o8-input') as HTMLTextAreaElement | null;
      if (!input) return;
      input.value = FIRST_GENERATION_EXAMPLE;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
  }

  // Enter key in input
  const mainInput = el('o8-input') as HTMLTextAreaElement | null;
  if (mainInput) {
    mainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(root); }
    });
  }

  // Mic — Web Speech API works natively in Side Panel (extension page origin)
  const mic = el('o8-mic');
  if (mic && mainInput) attachMic(mainInput, mic);

  // Settings panel
  const settingsPanel = el('o8-settings-panel');
  const settingsBack = el('o8-settings-back');
  if (settingsBack) {
    settingsBack.onclick = () => { settingsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };
  }
  const settingsBtnInline = el('o8-settings-btn-inline');
  if (settingsBtnInline) {
    settingsBtnInline.onclick = () => {
      el('o8-quick')!.style.display = 'none';
      const tp = el('o8-tools-panel'); if (tp) tp.style.display = 'none';
      if (settingsPanel) settingsPanel.style.display = 'flex';
    };
  }

  // Tone/goal radios
  root.querySelectorAll('input[name="brevmont-tone"]').forEach(radio => {
    radio.addEventListener('change', () => { chrome.storage.local.set({ brevmont_tone: (radio as HTMLInputElement).value }); });
  });
  root.querySelectorAll('input[name="brevmont-goal"]').forEach(radio => {
    radio.addEventListener('change', () => { chrome.storage.local.set({ brevmont_goal: (radio as HTMLInputElement).value }); });
  });
  // Restore saved tone/goal
  chrome.storage.local.get(['brevmont_tone', 'brevmont_goal']).then(r => {
    if (r.brevmont_tone) { const e = root.querySelector(`input[name="brevmont-tone"][value="${r.brevmont_tone}"]`) as HTMLInputElement; if (e) e.checked = true; }
    if (r.brevmont_goal) { const e = root.querySelector(`input[name="brevmont-goal"][value="${r.brevmont_goal}"]`) as HTMLInputElement; if (e) e.checked = true; }
  });

  // ─── Account info (migrated from popup) ─────────────────────────────────────
  loadAccountInfo(root);
  const copyBtn = root.querySelector('#sp-copy-license') as HTMLButtonElement;
  if (copyBtn) {
    copyBtn.onclick = () => {
      chrome.storage.local.get(['dealer_token']).then(r => {
        const t = r.dealer_token as string;
        if (t) { navigator.clipboard.writeText(t).then(() => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000); }); }
      });
    };
  }
  const reportBtn = root.querySelector('#sp-link-report') as HTMLButtonElement;
  if (reportBtn) {
    reportBtn.onclick = async () => {
      reportBtn.disabled = true; reportBtn.textContent = 'Sending...';
      try {
        let tabDomain: string | null = null;
        try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab?.url) tabDomain = new URL(tab.url).hostname; } catch { /* noop */ }
        await chrome.runtime.sendMessage({ type: 'SUPPORT_REPORT', payload: { note: '', tab_domain: tabDomain } });
        reportBtn.textContent = 'Sent!';
      } catch { reportBtn.textContent = 'Failed'; }
      setTimeout(() => { reportBtn.disabled = false; reportBtn.textContent = 'Report issue'; }, 3000);
    };
  }
  const helpBtn = root.querySelector('#sp-link-help') as HTMLButtonElement;
  if (helpBtn) {
    helpBtn.onclick = () => { chrome.tabs.create({ url: 'mailto:team@brevmont.com' }); };
  }

  // Tools panel
  const toolsPanel = el('o8-tools-panel');
  const toolsBack = el('o8-tools-back');
  const toolsBtnInline = el('o8-tools-btn-inline');
  if (toolsBtnInline) {
    toolsBtnInline.onclick = () => {
      el('o8-quick')!.style.display = 'none';
      if (toolsPanel) toolsPanel.style.display = 'flex';
      const coachInput = root.querySelector('#o8-coach-input') as HTMLTextAreaElement;
      if (coachInput) {
        setTimeout(() => {
          coachInput.focus();
          coachInput.placeholder = 'Tell Brevmont what the customer said, then click Coach Me below ↓';
        }, 100);
      }
    };
  }
  if (toolsBack) toolsBack.onclick = () => { toolsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };

  // Tool tab switching
  root.querySelectorAll('.tool-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      root.querySelectorAll('.tool-content').forEach(c => (c as HTMLElement).style.display = 'none');
      const tool = (btn as HTMLElement).dataset.tool;
      const target = root.querySelector(`#tool-${tool}`) as HTMLElement;
      if (target) target.style.display = 'block';
    });
  });

  // Stats panel
  const statsPanel = el('o8-stats-panel');
  const statsBack = el('o8-stats-back');
  const statsBtnInline = el('o8-stats-btn-inline');
  if (statsBtnInline) statsBtnInline.onclick = () => openStats(root);
  if (statsBack) statsBack.onclick = () => { statsPanel!.style.display = 'none'; el('o8-quick')!.style.display = 'flex'; };

  // Coach
  const coachBtn = el('o8-coach-btn');
  if (coachBtn) coachBtn.onclick = () => doCoach(root);
  const coachMic = el('o8-coach-mic');
  const coachInput = el('o8-coach-input') as HTMLTextAreaElement | null;
  if (coachMic && coachInput) attachMic(coachInput, coachMic);

  // Coach chips
  root.querySelectorAll('.coach-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = el('o8-coach-input') as HTMLTextAreaElement;
      if (input) input.value = (chip as HTMLElement).textContent || '';
      void doCoach(root);
    });
  });

  // Alerts
  const alertBtn = el('o8-alert-btn');
  if (alertBtn) alertBtn.onclick = () => doSetAlert(root);
  const alertMic = el('o8-alert-mic');
  const alertInput = el('o8-alert-input') as HTMLInputElement | null;
  if (alertMic && alertInput) attachMic(alertInput, alertMic);

  // Context tool (screenshot + generate reply)
  wireContextTool(root);

  // Command tool
  const cmdBtn = el('o8-cmd-execute');
  if (cmdBtn) cmdBtn.onclick = () => doCommand(root);
  const cmdMic = el('o8-cmd-mic');
  const cmdInput = el('o8-cmd-input') as HTMLTextAreaElement | null;
  if (cmdMic && cmdInput) attachMic(cmdInput, cmdMic);

  // Lead capture panel
  wireLeadCapture(root);

  // Platform badge update
  updatePlatformBadge(root);

  // No close button in Side Panel — Chrome handles that natively.
  // Hide the X if it exists (carried over from content.ts HTML).
  const closeBtn = el('o8-close');
  if (closeBtn) closeBtn.style.display = 'none';
}

// ─── Tab-switching for output cards ──────────────────────────────────────────
function setActiveOutputTab(root: HTMLElement, type: string): void {
  root.querySelectorAll('.chip').forEach(c => c.classList.remove('tab-active'));
  const chip = root.querySelector(`.chip[data-type="${type}"]`);
  if (chip) chip.classList.add('tab-active');
  root.querySelectorAll('.out-card[data-output-type]').forEach(card => {
    (card as HTMLElement).classList.toggle('tab-visible', card.getAttribute('data-output-type') === type);
  });
}

// ─── Platform badge ──────────────────────────────────────────────────────────
function updatePlatformBadge(root: HTMLElement): void {
  const badge = getBadge(currentPlatform.platform);
  const badgeEl = root.querySelector('#o8-platform-badge') as HTMLElement;
  if (badgeEl && badge.label) {
    badgeEl.textContent = badge.label;
    badgeEl.style.color = badge.color;
    badgeEl.style.background = badge.bg;
    badgeEl.style.display = 'inline-block';
  } else if (badgeEl) {
    badgeEl.style.display = 'none';
  }
}

// ─── Mic (Direct SpeechRecognition in Side Panel) ───────────────────────────
// SpeechRecognition works natively in chrome-extension:// side panel pages.
// ─── Microphone ─────────────────────────────────────────────────────────────
// Chrome SILENTLY SWALLOWS SpeechRecognition.start() in side panels when
// mic permission hasn't been granted — no error, no event, nothing fires.
//
// Architecture:
// 1. Load mic permission flag into module var at boot (async, before any click)
// 2. Click handler is fully SYNCHRONOUS — checks module var, no await
// 3. If not granted → open mic-permission.html via background + two fallbacks
// 4. mic-permission.html sets the flag → next click goes to recognition
// 5. Timeout guard catches revoked permission (onstart doesn't fire in 1500ms)
let activeMicRecognition: any = null;
let activeMicBtn: HTMLElement | null = null;
const MIC_PERM_KEY = 'brevmont_mic_granted';
let micPermGranted = false; // sync module-level flag, loaded at boot

// Load permission state at boot — called once during init
function loadMicPermFlag(): void {
  try {
    chrome.storage.local.get([MIC_PERM_KEY], (result) => {
      micPermGranted = !!result?.[MIC_PERM_KEY];
    });
  } catch { /* storage unavailable — flag stays false */ }
}
loadMicPermFlag(); // fire immediately at module load

// Listen for flag changes (set by mic-permission.html after user grants access)
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MIC_PERM_KEY]) {
      micPermGranted = !!changes[MIC_PERM_KEY].newValue;
    }
  });
} catch { /* side panel may not support onChanged — non-critical */ }

function openMicPermissionPage(): void {
  const url = chrome.runtime.getURL('permission.html');
  // Cascade: background message → chrome.tabs.create → window.open
  // Each level catches the previous failure.
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_MIC_PERMISSION' }, () => {
      if (chrome.runtime.lastError) {
        try {
          chrome.tabs.create({ url });
        } catch {
          window.open(url, '_blank', 'width=420,height=340,popup=yes');
        }
      }
    });
  } catch {
    try {
      chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank', 'width=420,height=340,popup=yes');
    }
  }
}

function attachMic(input: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement): void {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    micBtn.style.display = 'none';
    return;
  }

  // FULLY SYNCHRONOUS click handler — no async, no await, no silent rejections
  micBtn.addEventListener('click', () => {
    // If this mic is active — stop it
    if (activeMicBtn === micBtn && activeMicRecognition) {
      activeMicRecognition.stop();
      return;
    }
    // If another mic is active — stop that one first
    if (activeMicRecognition) {
      activeMicRecognition.stop();
    }

    // Gate: if mic permission was never granted, open bootstrap page immediately
    if (!micPermGranted) {
      openMicPermissionPage();
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Grant microphone access in the popup, then click mic again.');
      return;
    }

    // Permission was granted before — start recognition with timeout guard.
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';
    const existingText = input.value;
    let started = false;

    // Timeout guard: if onstart hasn't fired within 1500ms, Chrome silently
    // swallowed the request (permission revoked, or browser cleared it).
    const startTimeout = setTimeout(() => {
      if (!started) {
        micPermGranted = false;
        try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
        openMicPermissionPage();
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Microphone permission expired. Grant access again.');
        micBtn.classList.remove('mic-active');
        activeMicRecognition = null;
        activeMicBtn = null;
      }
    }, 1500);

    recognition.onstart = () => {
      started = true;
      clearTimeout(startTimeout);
      activeMicRecognition = recognition;
      activeMicBtn = micBtn;
      micBtn.classList.add('mic-active');
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      input.value = existingText + finalTranscript + interimTranscript;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    recognition.onerror = (event: any) => {
      clearTimeout(startTimeout);
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micPermGranted = false;
        try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
        openMicPermissionPage();
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Grant microphone access, then click mic again.');
      } else {
        const root = document.getElementById('sp-root');
        if (root) showToast(root, 'Mic error: ' + event.error);
      }
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    };

    recognition.onend = () => {
      clearTimeout(startTimeout);
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    };

    try {
      recognition.start();
    } catch (e: any) {
      clearTimeout(startTimeout);
      micPermGranted = false;
      try { chrome.storage.local.remove(MIC_PERM_KEY); } catch {}
      openMicPermissionPage();
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Grant microphone access, then click mic again.');
      micBtn.classList.remove('mic-active');
      activeMicRecognition = null;
      activeMicBtn = null;
    }
  });
}

// ─── Generate ────────────────────────────────────────────────────────────────
async function doGenerate(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  if (isGenerating) return;
  isGenerating = true;

  const input = (root.querySelector('#o8-input') as HTMLTextAreaElement)?.value.trim() || '';
  const chips = root.querySelectorAll('.chip.on');
  const selected = Array.from(chips).map(c => c.getAttribute('data-type'));
  if (selected.length === 0) { isGenerating = false; return; }

  const type = selected.length === 3 ? 'all' : selected.length === 1 ? selected[0]! : 'all';
  const btn = root.querySelector('#o8-generate') as HTMLButtonElement;
  btn.innerHTML = '<span class="gen-spinner"></span> Generating…';
  btn.disabled = true;
  root.querySelector('#o8-outputs')!.innerHTML = '';
  root.querySelectorAll('.chip.tab-active').forEach(c => c.classList.remove('tab-active'));

  let tone = 'professional', goal = 'close_deal';
  try {
    const stored = await chrome.storage.local.get(['brevmont_tone', 'brevmont_goal']);
    tone = stored.brevmont_tone || 'professional';
    goal = stored.brevmont_goal || 'close_deal';
  } catch {}

  // Ask content script for lead context (DOM scraping happens there)
  let leadContext: any = {};
  try {
    const ctx = await sendToContent({ type: 'GET_LEAD_CONTEXT' });
    if (ctx) leadContext = ctx;
  } catch {}

  const _generationId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const _meta: Record<string, any> = {
    workflow_type: type === 'all' ? 'all' : type,
    customer_name: leadContext.customerName || null,
    vehicle: leadContext.vehicle || null,
    customer_phone: leadContext.phone || null,
    customer_email: leadContext.email || null,
    email: leadContext.email || null,
    vehicle_make: leadContext.vehicleMake || null,
    vehicle_model: leadContext.vehicleModel || null,
    vehicle_of_interest: leadContext.vehicleOfInterest || leadContext.vehicle || null,
    lead_source: leadContext.source || null,
    generation_id: _generationId,
    lead_id: (root as any).__pendingLeadId || null,
  };

  try {
    const response = await safeSend({
      type: 'GENERATE_OUTPUT',
      payload: {
        type, leadContext, repInput: input + (leadContext.vehicle ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not mention or invent a vehicle in the response.]'),
        repName: '', dealership: '', platform: currentPlatform.platform, tone, goal,
        metadata: _meta,
        lead_id: (root as any).__pendingLeadId || null,
      },
    });
    // Clear pending lead_id after sending
    (root as any).__pendingLeadId = null;

    if (response?.generation_limit_reached) {
      showUpgradePrompt(root, response.message || 'You\'ve used all your free follow-ups this month.', response.upgrade_url);
      updateUsageCounter(root);
    } else if (response?.queued) {
      showToast(root, response.message || 'Saved. Will sync when online.');
    } else if (response?.error) {
      addOutput(root, 'Error', response.error);
    } else {
      const sec = response.sections;
      if (selected.includes('text') && sec?.text) addOutput(root, 'MESSAGE', sec.text, 'text');
      if (selected.includes('email') && sec?.email) addOutput(root, 'EMAIL', sec.email, 'email');
      if (selected.includes('crm') && sec?.crm) {
        if (sec.crm.trim() === 'NO_NEW_NOTE') showToast(root, 'Nothing new to log. Last note covers this.');
        else addOutput(root, 'CRM NOTE', sec.crm, 'crm');
      }
      if (!sec?.text && !sec?.email && !sec?.crm) addOutput(root, 'GENERATION', response.text || 'Generation returned empty.');

      // Auto-activate first tab
      const tabOrder: Array<'text' | 'email' | 'crm'> = ['text', 'email', 'crm'];
      const firstReady = tabOrder.find(t => !!root.querySelector(`.out-card[data-output-type="${t}"]`));
      if (firstReady) setActiveOutputTab(root, firstReady);
      await markFirstGenerationComplete(root);

      // Honest event tracking via background
      try {
        const outputs: Array<{ key: string; content: string }> = [];
        if (selected.includes('text') && sec?.text) outputs.push({ key: 'text', content: sec.text });
        if (selected.includes('email') && sec?.email) outputs.push({ key: 'email', content: sec.email });
        if (selected.includes('crm') && sec?.crm && sec.crm.trim() !== 'NO_NEW_NOTE') outputs.push({ key: 'crm', content: sec.crm });
        for (const o of outputs) {
          safeSend({
            type: 'LOG_HONEST_EVENT',
            payload: {
              event_type: 'generation.created',
              platform: currentPlatform.platform,
              output_type: o.key === 'text' ? 'sms' : o.key === 'email' ? 'email' : 'crm_note',
              generation_id: _generationId,
              customer_context: { name: _meta.customer_name, vehicle: _meta.vehicle },
              output_length: (o.content || '').length,
            },
          }).catch(() => {});
        }
      } catch {}

      // Increment local usage counter for immediate UI feedback (free tier)
      chrome.storage.local.get(['brevmont_tier', 'brevmont_usage']).then(data => {
        if (data.brevmont_tier === 'free' && data.brevmont_usage) {
          const u = data.brevmont_usage as { generations_used?: number; generations_limit?: number };
          const newUsed = (u.generations_used || 0) + 1;
          chrome.storage.local.set({
            brevmont_usage: { ...u, generations_used: newUsed, generations_remaining: Math.max(0, (u.generations_limit || 500) - newUsed) },
          });
        }
      }).catch(() => {});
      updateUsageCounter(root);
    }
  } catch (e: any) {
    addOutput(root, 'Error', e.message || 'Generation failed');
  }

  btn.innerHTML = 'Generate';
  btn.disabled = false;
  isGenerating = false;
}

// ─── Add output card ─────────────────────────────────────────────────────────
function addOutput(root: HTMLElement, label: string, content: string, outputType?: string): void {
  const outputs = root.querySelector('#o8-outputs')!;
  const card = document.createElement('div');
  card.className = 'out-card';
  if (outputType) {
    card.setAttribute('data-output-type', outputType);
    card.classList.add('tab-visible');
  }
  card.innerHTML = `
    <div class="out-label">${esc(label)}</div>
    <textarea class="out-textarea" rows="${outputType === 'email' ? 16 : outputType === 'crm' ? 8 : 5}" readonly>${esc(content)}</textarea>
    <div class="out-actions">
      <button class="out-action out-primary">Copy</button>
      ${currentPlatform.platform !== 'unknown' ? '<button class="out-action out-primary">Inject</button>' : ''}
      <button class="out-action out-regen">Regen</button>
    </div>
    <div class="out-status"></div>
  `;

  // Copy
  card.querySelector('.out-primary')!.addEventListener('click', async () => {
    const ta = card.querySelector('.out-textarea') as HTMLTextAreaElement;
    await navigator.clipboard.writeText(ta.value);
    const status = card.querySelector('.out-status') as HTMLElement;
    status.textContent = 'Copied';
    status.style.color = '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });

  // Inject — send to content script
  const injectBtn = card.querySelectorAll('.out-primary')[1] as HTMLElement | undefined;
  if (injectBtn) {
    injectBtn.addEventListener('click', async () => {
      const ta = card.querySelector('.out-textarea') as HTMLTextAreaElement;
      const status = card.querySelector('.out-status') as HTMLElement;
      try {
        await sendToContent({
          type: 'INJECT_CONTENT',
          payload: { content: ta.value, outputType: outputType || 'text', platform: currentPlatform.platform },
        });
        status.textContent = 'Injected';
        status.style.color = '#16a34a';
      } catch (e: any) {
        status.textContent = e.message || 'Inject failed';
        status.style.color = '#ef4444';
      }
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  }

  // Regen
  const regenBtn = card.querySelector('.out-regen') as HTMLElement;
  if (regenBtn) regenBtn.addEventListener('click', () => doGenerate(root));

  outputs.appendChild(card);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(root: HTMLElement, msg: string): void {
  const existing = root.querySelector('#brevmont-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'brevmont-toast';
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#1a202c', color: '#fff', padding: '8px 16px', borderRadius: '6px',
    fontSize: '11px', fontWeight: '500', zIndex: '99', opacity: '1', transition: 'opacity 0.3s',
  });
  root.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ─── Coach ────────────────────────────────────────────────────────────────────
async function doCoach(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  const input = (root.querySelector('#o8-coach-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) {
    showToast(root, 'Type a sales scenario first, then click Coach Me.');
    return;
  }
  const output = root.querySelector('#o8-coach-output') as HTMLElement;
  const coachBtn = root.querySelector('#o8-coach-btn') as HTMLButtonElement | null;
  if (coachBtn) {
    coachBtn.disabled = true;
    coachBtn.textContent = 'Thinking...';
  }
  output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Thinking...</div>';
  try {
    await requireToken();
    const resp = await safeSend({ type: 'COACH_ME', payload: { situation: input, platform: currentPlatform.platform } });
    const text = resp?.coaching || resp?.text || '';
    if (!text) {
      output.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response from Coach. Try again.</div>';
      return;
    }
    output.innerHTML = `<div class="tool-result">${esc(text)}</div>`;
  } catch (e: any) {
    output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
  } finally {
    if (coachBtn) {
      coachBtn.disabled = false;
      coachBtn.textContent = 'Coach Me';
    }
  }
}

// ─── Alert Time Parser (ported from content.ts) ─────────────────────────────
function parseAlertTime(text: string): number {
  const now = Date.now();
  const inMin = text.match(/in\s+(\d+)\s*min/i);
  if (inMin) return now + parseInt(inMin[1]) * 60000;
  const inHr = text.match(/in\s+(\d+)\s*hour/i);
  if (inHr) return now + parseInt(inHr[1]) * 3600000;
  if (/\bnoon\b/i.test(text)) { const d = new Date(); d.setHours(12, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
  if (/\b(eod|end of day|close of business|cob)\b/i.test(text)) { const d = new Date(); d.setHours(17, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
  const isTomorrow = /\btomorrow\b/i.test(text);
  const byTime = text.match(/(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (byTime) {
    let h = parseInt(byTime[1]); const m = byTime[2] ? parseInt(byTime[2]) : 0;
    const ampm = (byTime[3] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (!ampm && h < 7) h += 12;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (isTomorrow) d.setDate(d.getDate() + 1);
    else if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return now + 30 * 60000;
}

// ─── Set Alert ───────────────────────────────────────────────────────────────
async function doSetAlert(root: HTMLElement): Promise<void> {
  const input = (root.querySelector('#o8-alert-input') as HTMLInputElement)?.value.trim();
  if (!input) return;
  try {
    await safeSend({ type: 'SET_ALERT', payload: { task: input, alertTime: parseAlertTime(input) } });
    (root.querySelector('#o8-alert-input') as HTMLInputElement).value = '';
    showToast(root, 'Alert set');
    loadAlerts(root);
  } catch {}
}

async function loadAlerts(root: HTMLElement): Promise<void> {
  const list = root.querySelector('#o8-alert-list') as HTMLElement;
  if (!list) return;
  try {
    const alerts = await safeSend({ type: 'GET_ALERTS' });
    if (!alerts || alerts.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">No active reminders</div>';
      return;
    }
    list.innerHTML = alerts.map((a: any) =>
      `<div class="alert-item"><span>${esc(a.task)}</span><span class="alert-time">${new Date(a.alertTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="alert-dismiss" data-id="${a.id}">&times;</button></div>`
    ).join('');
    list.querySelectorAll('.alert-dismiss').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (id) { await safeSend({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(root); }
      });
    });
  } catch {}
}

// ─── Command ─────────────────────────────────────────────────────────────────
async function doCommand(root: HTMLElement): Promise<void> {
  if (!(await ensureGenerationAllowed(root))) return;
  const input = (root.querySelector('#o8-cmd-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) return;
  const status = root.querySelector('#o8-cmd-status') as HTMLElement;
  status.innerHTML = '<div class="tool-result" style="color:#94a3b8">Executing...</div>';
  try {
    await requireToken();
    const resp = await safeSend({ type: 'EXECUTE_COMMAND', payload: { command: input, platform: currentPlatform.platform } });
    // API returns { parsed: { action, content, ... }, usage }.
    // Display the content field from the parsed command JSON.
    const text = resp?.parsed?.content || resp?.result || resp?.text || '';
    if (!text) {
      status.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response. Try again.</div>';
      return;
    }
    status.innerHTML = `<div class="tool-result">${esc(text)}</div>`;
  } catch (e: any) {
    status.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
  }
}

// ─── Context Tool (screenshot + reply) ───────────────────────────────────────
function wireContextTool(root: HTMLElement): void {
  const dropzone = root.querySelector('#o8-ctx-dropzone') as HTMLElement;
  const preview = root.querySelector('#o8-ctx-preview') as HTMLElement;
  const img = root.querySelector('#o8-ctx-img') as HTMLImageElement;
  const removeBtn = root.querySelector('#o8-ctx-remove') as HTMLElement;
  const captureBtn = root.querySelector('#o8-ctx-capture') as HTMLButtonElement | null;
  const genBtn = root.querySelector('#o8-ctx-generate') as HTMLButtonElement;
  const directionInput = root.querySelector('#o8-ctx-direction') as HTMLTextAreaElement;
  const output = root.querySelector('#o8-ctx-output') as HTMLElement;
  let screenshotData: string | null = null;

  if (!dropzone) return;

  const setScreenshot = (dataUrl: string) => {
    screenshotData = dataUrl;
    if (img) img.src = screenshotData;
    if (preview) preview.style.display = 'block';
    if (dropzone) dropzone.style.display = 'none';
    if (genBtn) genBtn.disabled = false;
  };

  dropzone.tabIndex = 0;
  dropzone.addEventListener('click', () => dropzone.focus());

  // Paste handler
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            setScreenshot(reader.result as string);
          };
          reader.readAsDataURL(blob);
        }
        e.preventDefault();
        break;
      }
    }
  };
  document.addEventListener('paste', handlePaste);
  dropzone.addEventListener('paste', handlePaste);

  if (captureBtn) {
    captureBtn.onclick = async () => {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing...';
      try {
        await requireToken();
        const resp = await safeSend({ type: 'CAPTURE_SCREENSHOT' });
        if (!resp?.image) throw new Error(resp?.error || 'Screenshot capture failed');
        setScreenshot(resp.image);
      } catch (e: any) {
        output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message || 'Screenshot capture failed')}</div>`;
      } finally {
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture Current Tab';
      }
    };
  }

  if (removeBtn) {
    removeBtn.onclick = () => {
      screenshotData = null;
      preview.style.display = 'none';
      dropzone.style.display = 'flex';
      genBtn.disabled = true;
    };
  }

  if (genBtn) {
    genBtn.onclick = async () => {
      if (!(await ensureGenerationAllowed(root))) return;
      if (!screenshotData) return;
      const direction = directionInput?.value.trim() || '';
      output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Analyzing screenshot...</div>';
      try {
        await requireToken();
        const resp = await safeSend({
          type: 'CONTEXT_REPLY',
          payload: { image: screenshotData, direction },
        });
        const replyText = resp?.reply || resp?.text || '';
        if (!replyText) {
          output.innerHTML = '<div class="tool-result" style="color:#ef4444">Empty response. Try again.</div>';
          return;
        }
        output.innerHTML = `<div class="out-card"><div class="out-label">SCREENSHOT REPLY</div><textarea class="out-textarea" rows="5" readonly>${esc(replyText)}</textarea><div class="out-actions"><button class="out-action out-primary">Copy</button><button class="out-action out-regen">Regen</button></div></div>`;
        output.querySelector('.out-primary')?.addEventListener('click', async () => { await navigator.clipboard.writeText(replyText); const b = output.querySelector('.out-primary'); if (b) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 2000); } });
        output.querySelector('.out-regen')?.addEventListener('click', () => genBtn.click());
      } catch (e: any) {
        output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
      }
    };
  }

  // Mic for context direction
  const ctxMic = root.querySelector('#o8-ctx-mic') as HTMLElement;
  if (ctxMic && directionInput) attachMic(directionInput, ctxMic);
}

// ─── Pipeline stage helpers ──────────────────────────────────────────────────
const PIPELINE_STAGES = ['captured', 'contacted', 'appointment_set', 'showed', 'sold', 'lost'] as const;
type PipelineStage = typeof PIPELINE_STAGES[number];

function stageLabelMap(stage: string): string {
  const map: Record<string, string> = {
    captured: 'Captured', contacted: 'Contacted', appointment_set: 'Appt Set',
    showed: 'Showed', sold: 'Sold', lost: 'Lost',
  };
  return map[stage] || stage;
}

function stageBadgeStyle(stage: string): string {
  const map: Record<string, string> = {
    captured: 'background:#F1F5F9;color:#475569;',
    contacted: 'background:#EFF6FF;color:#1D4ED8;',
    appointment_set: 'background:#F5F3FF;color:#7C3AED;',
    showed: 'background:#F0FDFA;color:#0F766E;',
    sold: 'background:#F0FDF4;color:#166534;',
    lost: 'background:#FEF2F2;color:#991B1B;',
  };
  return map[stage] || 'background:#F1F5F9;color:#475569;';
}

function getNextStage(current: string): PipelineStage | null {
  const mainFlow: PipelineStage[] = ['captured', 'contacted', 'appointment_set', 'showed', 'sold'];
  const idx = mainFlow.indexOf(current as PipelineStage);
  if (idx >= 0 && idx < mainFlow.length - 1) return mainFlow[idx + 1];
  return null;
}

// ─── Show parsed lead result ─────────────────────────────────────────────────
function showLeadResult(root: HTMLElement, lead: any): void {
  const result = root.querySelector('#o8-lead-result') as HTMLElement;
  if (!result || !lead) return;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name || lead.customer_name || 'Unknown';
  const vehicle = lead.vehicle_of_interest || lead.vehicle_interest || '';
  const rawText = lead.source_raw_text || '';
  const leadId = lead.id || null;
  const pipelineStage = lead.pipeline_stage || 'captured';
  const heatScore = lead.heat_score ?? null;
  const hasTrade = lead.has_trade_in || false;
  const hasFinance = lead.finance_intent || false;
  const nextStage = getNextStage(pipelineStage);

  result.style.display = 'block';
  result.innerHTML = `<div class="tool-result">
    <strong>${esc(name)}</strong>
    ${lead.phone ? '<br/>' + esc(lead.phone) : ''}
    ${lead.email ? '<br/>' + esc(lead.email) : ''}
    ${vehicle ? '<br/><span style="color:#2563eb;font-size:11px">' + esc(vehicle) + '</span>' : ''}
    <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">
      <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;${stageBadgeStyle(pipelineStage)}">${esc(stageLabelMap(pipelineStage))}</span>
      ${heatScore !== null ? `<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;${heatScore >= 70 ? 'background:#FEF2F2;color:#DC2626' : heatScore >= 40 ? 'background:#FFF7ED;color:#EA580C' : 'background:#F1F5F9;color:#64748B'}">🔥 ${heatScore}</span>` : ''}
      ${hasTrade ? '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:#FFFBEB;color:#92400E">Trade-in</span>' : ''}
      ${hasFinance ? '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:#EEF2FF;color:#4338CA">Finance</span>' : ''}
    </div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="out-action out-primary" id="o8-lead-copy">Copy</button>
      <button class="out-action" id="o8-lead-followup" style="background:#0D6E6E;color:#fff">Generate Reply</button>
      <button class="out-action" id="o8-lead-log-crm" style="background:#1E3A5F;color:#fff">Log to CRM</button>
    </div>
    ${leadId && nextStage && pipelineStage !== 'sold' && pipelineStage !== 'lost' ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #E5E7EB;display:flex;gap:6px;flex-wrap:wrap">
      <button class="out-action" id="o8-lead-advance" style="background:#0D6E6E;color:#fff;font-size:11px">→ ${esc(stageLabelMap(nextStage))}</button>
      <button class="out-action" id="o8-lead-lost" style="background:#fff;color:#DC2626;border:1px solid #FECACA;font-size:11px">Mark Lost</button>
    </div>` : ''}
  </div>`;

  // Copy button
  const copyBtn = result.querySelector('#o8-lead-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = [name, lead.phone, lead.email, vehicle].filter(Boolean).join('\n');
      await navigator.clipboard.writeText(text);
      (copyBtn as HTMLElement).textContent = 'Copied';
      setTimeout(() => { (copyBtn as HTMLElement).textContent = 'Copy'; }, 2000);
    });
  }

  // Feature 2: Generate Follow-Up — pre-fill main input with lead context + pass lead_id
  const followUpBtn = result.querySelector('#o8-lead-followup');
  if (followUpBtn) {
    followUpBtn.addEventListener('click', () => {
      const mainInput = root.querySelector('#o8-input') as HTMLTextAreaElement;
      if (mainInput) {
        mainInput.value = `Follow up with ${name}. ` +
          (vehicle ? `Vehicle interest: ${vehicle}. ` : '') +
          (lead.source_platform ? `Source: ${lead.source_platform}. ` : '') +
          (lead.phone ? `Phone: ${lead.phone}. ` : '') +
          (rawText ? `Original context: ${rawText.substring(0, 200)}` : '');
      }
      // Store lead_id for doGenerate to include in payload
      if (leadId) (root as any).__pendingLeadId = leadId;
      // Switch to Generate view
      const leadPanel = root.querySelector('#o8-lead-panel') as HTMLElement;
      if (leadPanel) leadPanel.style.display = 'none';
      root.querySelector('#o8-quick')!.setAttribute('style', 'display:flex');
      if (mainInput) mainInput.focus();
    });
  }

  // Feature 3: Log to CRM — inject into active field or clipboard fallback
  const logCrmBtn = result.querySelector('#o8-lead-log-crm') as HTMLButtonElement;
  if (logCrmBtn) {
    logCrmBtn.addEventListener('click', async () => {
      const noteText = [
        `[Brevmont Lead Capture]`,
        `Source: ${lead.source_platform || 'Extension'}`,
        `Name: ${name}`,
        lead.phone ? `Phone: ${lead.phone}` : null,
        lead.email ? `Email: ${lead.email}` : null,
        vehicle ? `Vehicle Interest: ${vehicle}` : null,
        `Captured: ${lead.captured_at ? new Date(lead.captured_at).toLocaleDateString() : 'Now'}`,
        ``,
        `--- Original Context ---`,
        rawText?.substring(0, 500) || 'No additional context',
      ].filter(Boolean).join('\n');

      // Try injecting into active CRM field
      let injected = false;
      try {
        const resp = await sendToContent({ type: 'INJECT_CONTENT', payload: { content: noteText, outputType: 'crm' } });
        injected = !!resp?.ok;
      } catch { /* content script unavailable */ }

      if (!injected) {
        // Clipboard fallback
        try {
          await navigator.clipboard.writeText(noteText);
          showToast(root, 'Copied to clipboard — paste into CRM notes');
        } catch {
          showToast(root, 'Could not copy. Try manually.');
          return;
        }
      } else {
        showToast(root, 'Lead logged to CRM');
      }

      // Update status to logged_to_crm
      if (leadId) {
        try {
          await safeSend({ type: 'UPDATE_LEAD_STATUS', payload: { leadId, status: 'logged_to_crm' } });
        } catch { /* non-fatal */ }
      }

      // Update button state
      logCrmBtn.textContent = 'Logged ✓';
      logCrmBtn.disabled = true;
      logCrmBtn.style.background = '#065F46';
    });
  }

  // Feature 4: Pipeline stage advancement
  const advanceBtn = result.querySelector('#o8-lead-advance') as HTMLButtonElement;
  if (advanceBtn && leadId && nextStage) {
    advanceBtn.addEventListener('click', async () => {
      advanceBtn.disabled = true;
      advanceBtn.textContent = '...';
      try {
        await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage: nextStage } });
        lead.pipeline_stage = nextStage;
        showLeadResult(root, lead);
        showToast(root, `Advanced to ${stageLabelMap(nextStage)}`);
      } catch (e: any) {
        showToast(root, e.message || 'Stage change failed');
        advanceBtn.disabled = false;
        advanceBtn.textContent = `→ ${stageLabelMap(nextStage)}`;
      }
    });
  }

  const lostBtn = result.querySelector('#o8-lead-lost') as HTMLButtonElement;
  if (lostBtn && leadId) {
    lostBtn.addEventListener('click', async () => {
      lostBtn.disabled = true;
      lostBtn.textContent = '...';
      try {
        await safeSend({ type: 'CHANGE_LEAD_STAGE', payload: { leadId, stage: 'lost' } });
        lead.pipeline_stage = 'lost';
        showLeadResult(root, lead);
        showToast(root, 'Marked as lost');
      } catch (e: any) {
        showToast(root, e.message || 'Stage change failed');
        lostBtn.disabled = false;
        lostBtn.textContent = 'Mark Lost';
      }
    });
  }
}

// ─── Lead Capture ────────────────────────────────────────────────────────────
function wireLeadCapture(root: HTMLElement): void {
  const leadBtn = root.querySelector('#o8-lead-btn') as HTMLElement;
  const leadPanel = root.querySelector('#o8-lead-panel') as HTMLElement;
  const leadBack = root.querySelector('#o8-lead-back') as HTMLElement;

  if (leadBtn) leadBtn.onclick = () => {
    root.querySelector('#o8-quick')!.setAttribute('style', 'display:none');
    const tp = root.querySelector('#o8-tools-panel') as HTMLElement; if (tp) tp.style.display = 'none';
    const sp = root.querySelector('#o8-settings-panel') as HTMLElement; if (sp) sp.style.display = 'none';
    if (leadPanel) leadPanel.style.display = 'flex';
  };
  if (leadBack) leadBack.onclick = () => {
    if (leadPanel) leadPanel.style.display = 'none';
    root.querySelector('#o8-quick')!.setAttribute('style', 'display:flex');
  };

  // Tab switching
  root.querySelectorAll('.lead-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.lead-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['lead-scan', 'lead-voice', 'lead-paste'].forEach(id => {
        const el = root.querySelector(`#${id}`) as HTMLElement;
        if (el) el.style.display = 'none';
      });
      const tab = (btn as HTMLElement).dataset.ltab;
      const target = root.querySelector(`#lead-${tab}`) as HTMLElement;
      if (target) target.style.display = 'block';
    });
  });

  // Scan — asks content script to scrape
  const scanBtn = root.querySelector('#o8-scan-btn') as HTMLElement;
  if (scanBtn) {
    scanBtn.onclick = async () => {
      scanBtn.textContent = 'Scanning...';
      const emptyMsg = root.querySelector('#o8-scan-empty') as HTMLElement;
      if (emptyMsg) emptyMsg.style.display = 'none';
      try {
        const ctx = await sendToContent({ type: 'SCAN_LEAD' });
        const detectedName = ctx?.customerName || ctx?.customer_name || ctx?.name || '';
        if (ctx && (detectedName || ctx.phone || ctx.email || ctx.raw_text || ctx.source_raw_text)) {
          await requireToken();
          const rawText = ctx.raw_text || ctx.source_raw_text || [
            detectedName ? `Name: ${detectedName}` : '',
            ctx.phone ? `Phone: ${ctx.phone}` : '',
            ctx.email ? `Email: ${ctx.email}` : '',
            ctx.vehicle || ctx.vehicle_interest ? `Vehicle: ${ctx.vehicle || ctx.vehicle_interest}` : '',
          ].filter(Boolean).join('\n');
          const resp = await safeSend({
            type: 'PARSE_LEAD',
            payload: {
              raw_text: rawText,
              platform: ctx.platform || currentPlatform.platform,
              customer_name: detectedName || null,
              name: detectedName || null,
              phone: ctx.phone || null,
              email: ctx.email || null,
              vehicle_interest: ctx.vehicle_interest || ctx.vehicle || null,
            },
          });
          showLeadResult(root, resp?.lead || resp || ctx);
        } else if (emptyMsg) {
          emptyMsg.style.display = 'block';
        }
      } catch (e: any) {
        showToast(root, e.message || 'Scan failed');
        if (emptyMsg) emptyMsg.style.display = 'block';
      }
      scanBtn.textContent = 'Scan This Page';
    };
  }

  // Voice mic for lead
  const leadVoiceInput = root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement;
  const leadVoiceMic = root.querySelector('#o8-lead-voice-mic') as HTMLElement;
  if (leadVoiceInput && leadVoiceMic) {
    attachMic(leadVoiceInput, leadVoiceMic);

    // Auto-trigger parse when mic stops and there's text (one-click voice capture)
    const micObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (!leadVoiceMic.classList.contains('mic-active') && leadVoiceInput.value.trim()) {
            const vParseBtn = root.querySelector('#o8-lead-voice-parse') as HTMLButtonElement;
            if (vParseBtn && !vParseBtn.disabled) vParseBtn.click();
          }
        }
      }
    });
    micObserver.observe(leadVoiceMic, { attributes: true });
  }

  // Voice parse button
  const voiceParseBtn = root.querySelector('#o8-lead-voice-parse') as HTMLButtonElement;
  if (voiceParseBtn) {
    voiceParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      voiceParseBtn.innerHTML = '<span class="gen-spinner"></span> Pulling details…';
      voiceParseBtn.disabled = true;
      try {
        await requireToken();
        const resp = await safeSend({ type: 'PARSE_LEAD', payload: { raw_text: input, platform: currentPlatform.platform } });
        showLeadResult(root, resp?.lead || resp);
      } catch (e: any) { showToast(root, e.message || 'Could not pull details'); }
      voiceParseBtn.innerHTML = 'Pull details';
      voiceParseBtn.disabled = false;
    };
  }

  // Paste parse button
  const pasteParseBtn = root.querySelector('#o8-lead-paste-parse') as HTMLButtonElement;
  if (pasteParseBtn) {
    pasteParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-paste-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      pasteParseBtn.innerHTML = '<span class="gen-spinner"></span> Pulling details…';
      pasteParseBtn.disabled = true;
      try {
        await requireToken();
        const resp = await safeSend({ type: 'PARSE_LEAD', payload: { raw_text: input, platform: currentPlatform.platform } });
        showLeadResult(root, resp?.lead || resp);
      } catch (e: any) { showToast(root, e.message || 'Could not pull details'); }
      pasteParseBtn.innerHTML = 'Pull details';
      pasteParseBtn.disabled = false;
    };
  }
}

// ─── Stats panel ─────────────────────────────────────────────────────────────
async function openStats(root: HTMLElement): Promise<void> {
  root.querySelector('#o8-quick')!.setAttribute('style', 'display:none');
  const tp = root.querySelector('#o8-tools-panel') as HTMLElement; if (tp) tp.style.display = 'none';
  const sp = root.querySelector('#o8-settings-panel') as HTMLElement; if (sp) sp.style.display = 'none';
  const statsPanel = root.querySelector('#o8-stats-panel') as HTMLElement;
  if (statsPanel) statsPanel.style.display = 'flex';
  const statsContent = root.querySelector('#o8-stats-content') as HTMLElement;
  if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px;">Loading stats...</div>';
  try {
    const resp = await safeSend({ type: 'GET_REP_STATS' });
    if (resp && statsContent) {
      const total = resp.total ?? 0;
      const today = resp.today_count ?? 0;
      const isZero = total === 0 && today === 0;
      statsContent.innerHTML = `
        ${isZero ? '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px 8px 8px;line-height:1.5;">Write your first follow-up to start tracking stats.</div>' : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="background:#F0FDF4;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#166534;">${total}</div>
            <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Total (30d)</div>
          </div>
          <div style="background:#EFF6FF;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#1E40AF;">${today}</div>
            <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Today</div>
          </div>
        </div>
        <div style="background:#FFF7ED;border-radius:8px;padding:10px;text-align:center;margin-bottom:8px;">
          <div style="font-size:20px;font-weight:700;color:#92400E;">&mdash;</div>
          <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:600;">Floor Rank</div>
        </div>
        <div style="text-align:center;margin-top:4px;"><button id="o8-export-csv" style="background:none;border:none;color:#0D6E6E;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline;">Export to CSV</button></div>`;
      // Wire CSV export button
      const csvBtn = statsContent.querySelector('#o8-export-csv') as HTMLElement;
      if (csvBtn) csvBtn.onclick = () => showToast(root, 'CSV export coming soon.');
    }
  } catch {
    if (statsContent) statsContent.innerHTML = '<div style="text-align:center;color:#EF4444;font-size:12px;padding:24px;">Could not load stats.</div>';
  }
}

// ─── Listen for tab changes to update platform ───────────────────────────────
chrome.tabs.onActivated.addListener(async () => {
  await refreshPlatform();
  const root = document.getElementById('sp-root');
  if (root && root.style.display !== 'none') updatePlatformBadge(root);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.url) {
    await refreshPlatform();
    const root = document.getElementById('sp-root');
    if (root && root.style.display !== 'none') updatePlatformBadge(root);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'TIER_CHANGED') return false;
  const root = document.getElementById('sp-root');
  if (root && root.style.display !== 'none') {
    applyFeatureGates(root);
    updateUsageCounter(root);
  }
  return false;
});

// ─── VinSolutions coexistence: show info banner when DOM sidebar is also active ─
async function checkCoexistence(root: HTMLElement): Promise<void> {
  if (currentPlatform.platform !== 'vinsolutions') return;
  try {
    const state = await sendToContent({ type: 'GET_SIDEBAR_STATE' });
    if (state?.sidebarOpen) {
      const banner = document.createElement('div');
      banner.id = 'sp-coexist-banner';
      banner.style.cssText = 'background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:8px 10px;margin:8px 12px 0;font-size:11px;color:#92400E;line-height:1.4;';
      banner.textContent = 'CRM sidebar is also open. Use the in-page sidebar for auto-inject, or this panel for cross-tab workflows.';
      const header = root.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', banner);
    }
  } catch { /* content script not available — ignore */ }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  await refreshPlatform();
  renderPanel();
  checkCoexistence(document.getElementById('sp-root')!);
})();
