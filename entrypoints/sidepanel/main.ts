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

// ─── Types ───────────────────────────────────────────────────────────────────
type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

interface PlatformContext {
  platform: Platform;
  tabId: number;
  url: string;
}

// ─── State ───────────────────────────────────────────────────────────────────
let currentPlatform: PlatformContext = { platform: 'unknown', tabId: -1, url: '' };
let isGenerating = false;

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
async function safeSend(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Message send failed'));
        return;
      }
      resolve(response);
    });
  });
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

// ─── Build panel DOM ─────────────────────────────────────────────────────────
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
    helpBtn.onclick = () => { chrome.tabs.create({ url: 'mailto:founder@brevmont.com' }); };
  }

  // Tools panel
  const toolsPanel = el('o8-tools-panel');
  const toolsBack = el('o8-tools-back');
  const toolsBtnInline = el('o8-tools-btn-inline');
  if (toolsBtnInline) toolsBtnInline.onclick = () => { el('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'flex'; };
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

// ─── Mic (Web Speech API) ────────────────────────────────────────────────────
function attachMic(input: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement): void {
  let recognition: any = null;
  let active = false;
  let finalText = '';

  function cleanupRecognition() {
    active = false;
    micBtn.classList.remove('mic-active');
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try { recognition.stop(); } catch {}
      recognition = null;
    }
  }

  micBtn.addEventListener('click', () => {
    if (active) {
      cleanupRecognition();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Voice not available in this browser.');
      return;
    }
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    finalText = input.value;

    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      input.value = finalText + interim;
    };
    recognition.onend = () => { if (active) try { recognition.start(); } catch { cleanupRecognition(); } };
    recognition.onerror = (e: any) => {
      if (e.error === 'aborted') return;
      const root = document.getElementById('sp-root');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        if (root) showToast(root, 'Mic permission denied. Enable in Chrome site settings.');
      } else if (e.error === 'audio-capture') {
        if (root) showToast(root, 'Mic in use by another tab or app.');
      } else {
        if (root) showToast(root, 'Mic error. Type your message.');
      }
      cleanupRecognition();
    };

    try {
      recognition.start();
      active = true;
      micBtn.classList.add('mic-active');
    } catch (e) {
      cleanupRecognition();
      const root = document.getElementById('sp-root');
      if (root) showToast(root, 'Voice not available. Type your message.');
    }
  });
}

// ─── Generate ────────────────────────────────────────────────────────────────
async function doGenerate(root: HTMLElement): Promise<void> {
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
  };

  try {
    const response = await safeSend({
      type: 'GENERATE_OUTPUT',
      payload: {
        type, leadContext, repInput: input + (leadContext.vehicle ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not mention or invent a vehicle in the response.]'),
        repName: '', dealership: '', platform: currentPlatform.platform, tone, goal,
        metadata: _meta,
      },
    });

    if (response?.queued) {
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
      if (!sec?.text && !sec?.email && !sec?.crm) addOutput(root, 'OUTPUT', response.text || 'Generation returned empty.');

      // Auto-activate first tab
      const tabOrder: Array<'text' | 'email' | 'crm'> = ['text', 'email', 'crm'];
      const firstReady = tabOrder.find(t => !!root.querySelector(`.out-card[data-output-type="${t}"]`));
      if (firstReady) setActiveOutputTab(root, firstReady);

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
  const input = (root.querySelector('#o8-coach-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) return;
  const output = root.querySelector('#o8-coach-output') as HTMLElement;
  output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Thinking...</div>';
  try {
    const resp = await safeSend({ type: 'COACH_ME', payload: { situation: input, platform: currentPlatform.platform } });
    output.innerHTML = `<div class="tool-result">${esc(resp?.coaching || resp?.text || 'No response')}</div>`;
  } catch (e: any) {
    output.innerHTML = `<div class="tool-result" style="color:#ef4444">${esc(e.message)}</div>`;
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
  const input = (root.querySelector('#o8-cmd-input') as HTMLTextAreaElement)?.value.trim();
  if (!input) return;
  const status = root.querySelector('#o8-cmd-status') as HTMLElement;
  status.innerHTML = '<div class="tool-result" style="color:#94a3b8">Executing...</div>';
  try {
    const resp = await safeSend({ type: 'EXECUTE_COMMAND', payload: { command: input, platform: currentPlatform.platform } });
    status.innerHTML = `<div class="tool-result">${esc(resp?.result || resp?.text || 'Done')}</div>`;
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
  const genBtn = root.querySelector('#o8-ctx-generate') as HTMLButtonElement;
  const directionInput = root.querySelector('#o8-ctx-direction') as HTMLTextAreaElement;
  const output = root.querySelector('#o8-ctx-output') as HTMLElement;
  let screenshotData: string | null = null;

  if (!dropzone) return;

  // Paste handler
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            screenshotData = reader.result as string;
            if (img) img.src = screenshotData;
            if (preview) preview.style.display = 'block';
            if (dropzone) dropzone.style.display = 'none';
            if (genBtn) genBtn.disabled = false;
          };
          reader.readAsDataURL(blob);
        }
        break;
      }
    }
  });

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
      if (!screenshotData) return;
      const direction = directionInput?.value.trim() || '';
      output.innerHTML = '<div class="tool-result" style="color:#94a3b8">Analyzing screenshot...</div>';
      try {
        const resp = await safeSend({
          type: 'CONTEXT_REPLY',
          payload: { image: screenshotData, direction },
        });
        const replyText = resp?.reply || resp?.text || 'No response';
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

// ─── Show parsed lead result ─────────────────────────────────────────────────
function showLeadResult(root: HTMLElement, lead: any): void {
  const result = root.querySelector('#o8-lead-result') as HTMLElement;
  if (!result || !lead) return;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name || 'Unknown';
  result.style.display = 'block';
  result.innerHTML = `<div class="tool-result">
    <strong>${esc(name)}</strong>
    ${lead.phone ? '<br/>' + esc(lead.phone) : ''}
    ${lead.email ? '<br/>' + esc(lead.email) : ''}
    ${lead.vehicle_of_interest ? '<br/><span style="color:#2563eb;font-size:11px">' + esc(lead.vehicle_of_interest) + '</span>' : ''}
    <div style="margin-top:8px"><button class="out-action out-primary" id="o8-lead-copy">Copy</button></div>
  </div>`;
  const copyBtn = result.querySelector('#o8-lead-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = [name, lead.phone, lead.email, lead.vehicle_of_interest].filter(Boolean).join('\n');
      await navigator.clipboard.writeText(text);
      (copyBtn as HTMLElement).textContent = 'Copied';
      setTimeout(() => { (copyBtn as HTMLElement).textContent = 'Copy'; }, 2000);
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
        const result = root.querySelector('#o8-lead-result') as HTMLElement;
        if (result && ctx && (ctx.name || ctx.phone || ctx.email)) {
          result.style.display = 'block';
          result.innerHTML = `<div class="tool-result"><strong>${esc(ctx.name || 'Unknown')}</strong><br/>${esc(ctx.phone || '')} ${esc(ctx.email || '')}</div>`;
        } else if (emptyMsg) {
          emptyMsg.style.display = 'block';
        }
      } catch {
        if (emptyMsg) emptyMsg.style.display = 'block';
      }
      scanBtn.textContent = 'Scan This Page';
    };
  }

  // Voice mic for lead
  const leadVoiceInput = root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement;
  const leadVoiceMic = root.querySelector('#o8-lead-voice-mic') as HTMLElement;
  if (leadVoiceInput && leadVoiceMic) attachMic(leadVoiceInput, leadVoiceMic);

  // Voice parse button
  const voiceParseBtn = root.querySelector('#o8-lead-voice-parse') as HTMLButtonElement;
  if (voiceParseBtn) {
    voiceParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-voice-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      voiceParseBtn.innerHTML = '<span class="gen-spinner"></span> Parsing…';
      voiceParseBtn.disabled = true;
      try {
        const resp = await safeSend({ type: 'PARSE_LEAD', payload: { raw_text: input, platform: currentPlatform.platform } });
        if (resp?.error) { showToast(root, 'Parse failed: ' + resp.error); }
        else { showLeadResult(root, resp?.lead || resp); }
      } catch (e: any) { showToast(root, 'Parse error: ' + (e.message || 'Unknown')); }
      voiceParseBtn.innerHTML = 'Parse';
      voiceParseBtn.disabled = false;
    };
  }

  // Paste parse button
  const pasteParseBtn = root.querySelector('#o8-lead-paste-parse') as HTMLButtonElement;
  if (pasteParseBtn) {
    pasteParseBtn.onclick = async () => {
      const input = (root.querySelector('#o8-lead-paste-input') as HTMLTextAreaElement)?.value?.trim();
      if (!input) return;
      pasteParseBtn.innerHTML = '<span class="gen-spinner"></span> Parsing…';
      pasteParseBtn.disabled = true;
      try {
        const resp = await safeSend({ type: 'PARSE_LEAD', payload: { raw_text: input, platform: currentPlatform.platform } });
        if (resp?.error) { showToast(root, 'Parse failed: ' + resp.error); }
        else { showLeadResult(root, resp?.lead || resp); }
      } catch (e: any) { showToast(root, 'Parse error: ' + (e.message || 'Unknown')); }
      pasteParseBtn.innerHTML = 'Parse';
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
        ${isZero ? '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px 8px 8px;line-height:1.5;">Generate your first message to start tracking stats.</div>' : ''}
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
