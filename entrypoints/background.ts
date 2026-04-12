/**
 * Brevmont Background Service Worker
 *
 * ALL generation goes through Railway proxy. No direct API calls.
 * No API keys in this file. Proxy owns the Anthropic key and system prompt.
 * Every generation event includes platform field.
 */

// No SYSTEM_PROMPT in extension — proxy resolves from vertical_config.
// No API keys in extension — all calls routed through PROXY_URL.

const PROXY_URL = 'https://oper8er-proxy-production.up.railway.app';

import { signedFetch } from '../lib/authSigning';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Health check — content script pings to verify service worker is alive
    if (msg.type === 'PING') { sendResponse({ pong: true }); return false; }

    if (msg.type === 'REPORT_ERROR') {
      const { error_type, error_message, context } = msg.payload || {};
      reportError(error_type || 'UNKNOWN', `[content] ${(error_message || 'unknown error').slice(0, 400)}${context ? ` | ctx: ${context}` : ''}`).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'GENERATE_OUTPUT') {
      handleGenerate(msg.payload)
        .then(sendResponse)
        .catch(err => {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('429') ? 'API_ERROR'
            : err.message?.includes('fetch') ? 'NETWORK_ERROR'
            : 'UNKNOWN';
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (msg.type === 'CHECK_FEATURES') {
      browser.storage.local.get(['floq_tier', 'floq_features', 'floq_last_heartbeat']).then(data => {
        const stale = !data.floq_last_heartbeat || (Date.now() - data.floq_last_heartbeat > 30 * 60 * 1000);
        const tier = stale ? 'floor' : (data.floq_tier || 'floor');
        sendResponse({ tier, features: data.floq_features || getTierFeatures(tier) });
      }).catch(() => sendResponse({ tier: 'floor', features: getTierFeatures('floor') }));
      return true;
    }

    if (msg.type === 'GET_SETTINGS') {
      browser.storage.sync.get(['rep_name', 'dealership', 'dealer_token'])
        .then(sendResponse);
      return true;
    }

    if (msg.type === 'LOG_ACTION') {
      const p = msg.payload;
      browser.storage.sync.get(['dealer_token', 'rep_name']).then(async (settings) => {
        try {
          await fetch(`${PROXY_URL}/api/log-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dealer_token: settings.dealer_token || '',
              action: p.action_type || 'unknown',
              customer_name: p.customer || null,
              vehicle: p.vehicle || null,
              platform: p.platform || 'unknown',
              rep_name: settings.rep_name || '',
              success: p.success ?? true,
              timestamp: new Date().toISOString()
            })
          });
        } catch(e: any) { console.error('[Brevmont] Log action failed:', e); reportError('API_ERROR', `Log action failed: ${e?.message || 'unknown'}`).catch(() => {}); }
      });
      return false;
    }

    if (msg.type === 'LOG_COPY') {
      const p = msg.payload;
      browser.storage.sync.get(['dealer_token', 'rep_name']).then(async (settings) => {
        try {
          await fetch(`${PROXY_URL}/api/log-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dealer_token: settings.dealer_token || '',
              action: p.label || 'COPY',
              customer_name: p.customer || null,
              vehicle: p.vehicle || null,
              platform: p.platform || 'unknown',
              rep_name: settings.rep_name || '',
              success: true,
              timestamp: new Date().toISOString()
            })
          });
        } catch(e) { console.error('[Brevmont] Log copy failed:', e); }
      });
      return false;
    }

    if (msg.type === 'OPEN_ONBOARDING') {
      browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') });
      return false;
    }

    if (msg.type === 'COACH_ME') {
      handleCoach(msg.payload)
        .then(sendResponse)
        .catch(err => {
          reportError('API_ERROR', `Coach: ${err.message}`).catch(() => {});
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (msg.type === 'EXECUTE_COMMAND') {
      handleCommand(msg.payload)
        .then(sendResponse)
        .catch(err => {
          reportError('API_ERROR', `Command: ${err.message}`).catch(() => {});
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (msg.type === 'CONTEXT_REPLY') {
      handleContextReply(msg.payload)
        .then(sendResponse)
        .catch(err => {
          reportError('API_ERROR', `ContextReply: ${err.message}`).catch(() => {});
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (msg.type === 'VOICE_REPLY') {
      handleVoiceReply(msg.payload)
        .then(sendResponse)
        .catch(err => {
          reportError('API_ERROR', `VoiceReply: ${err.message}`).catch(() => {});
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (msg.type === 'OPEN_COMMAND_MODE') {
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]?.id) {
          browser.tabs.sendMessage(tabs[0].id, { type: 'OPEN_COMMAND_TAB' }).catch(() => {});
        }
      }).catch(() => {});
      return false;
    }

    if (msg.type === 'SET_ALERT') {
      browser.storage.local.get('floq_alerts').then(data => {
        const alerts = data.floq_alerts || [];
        alerts.push({ id: Date.now().toString(), task: msg.payload.task, alertTime: msg.payload.alertTime, dismissed: false });
        browser.storage.local.set({ floq_alerts: alerts }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ error: 'Failed to set alert' }));
      return true;
    }

    if (msg.type === 'DISMISS_ALERT') {
      browser.storage.local.get('floq_alerts').then(data => {
        const alerts = data.floq_alerts || [];
        const updated = alerts.map((a: any) => a.id === msg.payload.id ? { ...a, dismissed: true } : a);
        browser.storage.local.set({ floq_alerts: updated }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === 'GET_ALERTS') {
      browser.storage.local.get('floq_alerts').then(data => {
        const alerts = data.floq_alerts || [];
        sendResponse(alerts.filter((a: any) => !a.dismissed));
      }).catch(() => sendResponse([]));
      return true;
    }

    // --- Pending Notes ---
    if (msg.type === 'SAVE_PENDING_NOTE') {
      browser.storage.sync.get(['dealer_token', 'rep_name']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No dealer_token' }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-notes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dealer_token: settings.dealer_token, rep_name: settings.rep_name || '', customer_name: msg.payload.customer_name || '', contact_id: msg.payload.contact_id || null, note_text: msg.payload.note_text })
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'GET_PENDING_NOTES') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ notes: [] }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-notes?dealer_token=${encodeURIComponent(settings.dealer_token)}`);
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ notes: [] }); }
      });
      return true;
    }

    if (msg.type === 'MARK_NOTE_LOGGED') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No token' }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-notes/${msg.payload.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dealer_token: settings.dealer_token, status: msg.payload.status || 'logged' })
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'SAVE_PENDING_EMAIL') {
      browser.storage.sync.get(['dealer_token', 'rep_name']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No dealer_token' }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-emails`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dealer_token: settings.dealer_token, rep_name: settings.rep_name || '', customer_name: msg.payload.customer_name || '', subject: msg.payload.subject || '', body: msg.payload.body || '' })
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'GET_PENDING_EMAILS') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ emails: [] }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-emails?dealer_token=${encodeURIComponent(settings.dealer_token)}`);
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ emails: [] }); }
      });
      return true;
    }

    if (msg.type === 'PARSE_LEAD') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No dealer_token' }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/parse-lead`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dealer_token: settings.dealer_token, raw_text: msg.payload.raw_text, platform: msg.payload.platform || 'unknown' })
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'MARK_EMAIL_APPLIED') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No token' }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-emails/${msg.payload.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dealer_token: settings.dealer_token, status: msg.payload.status || 'applied' })
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { sendResponse({ error: e.message }); }
      });
      return true;
    }
  });

  // ===== HEARTBEAT + ALERTS via chrome.alarms (MV3 compliant) =====
  async function sendHeartbeat() {
    try {
      const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
      if (!settings.dealer_token) return;
      const manifest = browser.runtime.getManifest();
      let platform = 'idle';
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) platform = new URL(tabs[0].url).hostname;
      } catch(e) {}
      const resp = await fetch(`${PROXY_URL}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_key: settings.dealer_token,
          rep_name: settings.rep_name || 'Unknown',
          dealership: settings.dealership || '',
          extension_version: manifest.version || '1.8.0',
          platform: platform,
          timestamp: new Date().toISOString()
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        // Store tier + features from heartbeat response
        const tier = data.tier || 'floor';
        await browser.storage.local.set({ floq_tier: tier, floq_features: data.features || getTierFeatures(tier), floq_last_heartbeat: Date.now() });
      }
    } catch(e) {
      reportError('NETWORK_ERROR', `Heartbeat failed: ${(e as Error).message}`).catch(() => {});
    }
  }

  async function checkAlerts() {
    const data = await browser.storage.local.get('floq_alerts');
    const alerts = data.floq_alerts || [];
    const now = Date.now();
    let changed = false;
    for (const alert of alerts) {
      if (alert.dismissed || alert.fired) continue;
      if (now >= alert.alertTime) {
        alert.fired = true;
        changed = true;
        const tabs = await browser.tabs.query({ active: true });
        for (const tab of tabs) {
          if (tab.id) {
            try { await browser.tabs.sendMessage(tab.id, { type: 'SHOW_ALERT_BANNER', payload: { id: alert.id, task: alert.task } }); } catch(e) {}
          }
        }
      }
    }
    if (changed) await browser.storage.local.set({ floq_alerts: alerts });
  }

  // Create alarms — survives service worker restarts
  browser.alarms.create('floq-heartbeat', { periodInMinutes: 5 });
  browser.alarms.create('floq-check-alerts', { periodInMinutes: 0.5 });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'floq-heartbeat') sendHeartbeat();
    if (alarm.name === 'floq-check-alerts') checkAlerts();
  });

  // Fire initial heartbeat after 10 seconds
  setTimeout(sendHeartbeat, 10000);

  // ===== AUTH HARDENING: Bootstrap license secret =====
  async function bootstrapLicenseSecret() {
    try {
      // Check if we already have a secret
      const existing = await browser.storage.local.get(['brevmont_license_secret']);
      if (existing.brevmont_license_secret) return;

      const settings = await browser.storage.sync.get(['dealer_token']);
      const licenseKey = settings.dealer_token;
      if (!licenseKey) return; // no license yet, onboarding handles this

      const response = await fetch(`${PROXY_URL}/v1/license/secret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey }),
      });

      if (!response.ok) {
        console.warn('[Brevmont] License secret bootstrap failed:', response.status);
        return;
      }

      const { license_secret } = await response.json();
      if (license_secret) {
        await browser.storage.local.set({ brevmont_license_secret: license_secret });
        console.log('[Brevmont] License secret bootstrapped successfully');
      }
    } catch (err) {
      console.warn('[Brevmont] License secret bootstrap error:', (err as Error).message);
    }
  }

  // Bootstrap secret on startup (after heartbeat settles)
  setTimeout(bootstrapLicenseSecret, 15000);

  // ===== ITEM 30: Extension version check =====
  async function checkVersionStatus() {
    try {
      const manifest = browser.runtime.getManifest();
      const chromeMatch = navigator.userAgent.match(/Chrome\/([\d.]+)/);
      const settings = await browser.storage.sync.get(['dealer_token']);

      const resp = await fetch(`${PROXY_URL}/v1/heartbeat/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealer_token: settings.dealer_token || '',
          extension_version: manifest.version || '1.9.2',
          chrome_version: chromeMatch ? chromeMatch[1] : 'unknown',
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();

      // Compare versions
      const current = (manifest.version || '1.9.2').split('.').map(Number);
      const minimum = (data.minimum_supported_version || '1.0.0').split('.').map(Number);
      let belowMinimum = false;
      for (let i = 0; i < Math.max(current.length, minimum.length); i++) {
        const diff = (current[i] || 0) - (minimum[i] || 0);
        if (diff < 0) { belowMinimum = true; break; }
        if (diff > 0) break;
      }

      await browser.storage.local.set({
        brevmont_version_status: {
          locked: belowMinimum,
          deprecated: data.deprecated,
          message: belowMinimum
            ? `Version ${manifest.version} is no longer supported. Please update to ${data.latest_version}.`
            : data.deprecated ? data.deprecation_notice : null,
          latest: data.latest_version,
        }
      });
    } catch (e) {
      // Silent — don't block on version check failure
    }
  }

  // Check version on startup (after 20s) and every hour
  setTimeout(checkVersionStatus, 20000);
  setInterval(checkVersionStatus, 60 * 60 * 1000);

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      if (browser.runtime.openOptionsPage) {
        browser.runtime.openOptionsPage();
      } else {
        browser.tabs.create({ url: browser.runtime.getURL('options.html') });
      }
    }
    // Bootstrap secret + version check on install/update
    setTimeout(bootstrapLicenseSecret, 5000);
    setTimeout(checkVersionStatus, 8000);
  });

  // Alt+K keyboard shortcut for Command Mode
  browser.commands?.onCommand?.addListener((command: string) => {
    if (command === 'open_command_mode') {
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]?.id) {
          browser.tabs.sendMessage(tabs[0].id, { type: 'OPEN_COMMAND_TAB' }).catch(() => {});
        }
      }).catch(() => {});
    }
  });
});

// --- Build rep context from profile for prompt injection ---
async function buildRepContext(): Promise<{ repName: string; dealership: string; contextBlock: string }> {
  const data = await browser.storage.sync.get(['profile', 'rep_name', 'dealership']);
  let profile: any = null;
  try { profile = data.profile ? JSON.parse(data.profile) : null; } catch(e) {}

  if (!profile) {
    // Fallback: old-style fields
    return {
      repName: data.rep_name || 'Sales Rep',
      dealership: data.dealership || 'Dealership',
      contextBlock: ''
    };
  }

  const id = profile.identity || {};
  const dl = profile.dealership || {};
  const vc = profile.voice || {};
  const mk = profile.market || {};

  const repName = `${id.firstName || ''} ${id.lastName || ''}`.trim() || 'Sales Rep';
  const dealership = dl.name || 'Dealership';

  let ctx = 'REP PROFILE:\n';
  ctx += `Name: ${repName}\n`;
  if (id.jobTitle) ctx += `Title: ${id.jobTitle}\n`;
  if (id.yearsExperience) ctx += `Experience: ${id.yearsExperience}\n`;
  ctx += `Dealership: ${dealership}\n`;
  if (dl.city && dl.state) ctx += `Location: ${dl.city}, ${dl.state}\n`;
  if (dl.crm) ctx += `CRM: ${dl.crm}\n`;
  if (mk.marketType) ctx += `Market type: ${mk.marketType}\n`;
  if (dl.saltRoads) ctx += `Road salting: ${dl.saltRoads} — ${dl.saltRoads === 'yes' ? 'affects rust and condition language for trades' : 'no road salt, less corrosion concern'}\n`;
  if (dl.docFee) ctx += `Doc fee: $${dl.docFee}\n`;
  if (dl.taxRate) ctx += `Tax rate: ${dl.taxRate}%\n`;
  if (dl.avgNewPrice) ctx += `Avg new car price: ${dl.avgNewPrice}\n`;
  if (dl.avgUsedPrice) ctx += `Avg used car price: ${dl.avgUsedPrice}\n`;

  ctx += '\nCOMMUNICATION STYLE:\n';
  if (vc.tone) ctx += `Tone: ${vc.tone}\n`;
  if (vc.emojis) ctx += `Emojis: ${vc.emojis}\n`;
  if (vc.textSignature) ctx += `Text signature: ${vc.textSignature}\n`;
  if (vc.emailSignoff) ctx += `Email sign-off: ${vc.emailSignoff}\n`;
  if (vc.languages?.length) ctx += `Languages: ${vc.languages.join(', ')}\n`;
  if (vc.philosophy) ctx += `Selling philosophy: ${vc.philosophy}\n`;

  if (mk.customerTypes?.length || mk.objections?.length || mk.customerNote) {
    ctx += '\nCUSTOMER CONTEXT:\n';
    if (mk.customerTypes?.length) ctx += `Primary customer types: ${mk.customerTypes.join(', ')}\n`;
    if (mk.objections?.length) ctx += `Common objections: ${mk.objections.join(', ')}\n`;
    if (mk.customerNote) ctx += `Market notes: ${mk.customerNote}\n`;
  }

  return { repName, dealership, contextBlock: ctx };
}

async function handleGenerate(payload: {
  type: string;
  leadContext: any;
  repInput: string;
  repName: string;
  dealership: string;
  platform?: string;
  metadata?: { workflow_type?: string; customer_name?: string | null; vehicle?: string | null };
}) {
  const settings = await browser.storage.sync.get(['dealer_token']);
  const { repName, dealership, contextBlock } = await buildRepContext();

  const finalRepName = payload.repName || repName;
  const finalDealership = payload.dealership || dealership;
  const dealerToken = settings.dealer_token || '';
  const detectedPlatform = payload.platform || 'chrome_extension';
  let userMessage = buildUserMessage(payload, finalRepName, finalDealership, contextBlock);

  let text: string;
  let usage: any = {};

  // All generation goes through Railway proxy — NO direct API calls, NO local keys
  if (!dealerToken) {
    throw new Error('No license key found. Complete onboarding at brevmont.com to activate Brevmont.');
  }

  // Fetch recent notes for same-lead dedup context
  const customerName = payload.metadata?.customer_name || payload.leadContext?.customerName || null;
  if (customerName && customerName !== 'there') {
    try {
      const recentResp = await fetch(`${PROXY_URL}/api/recent-notes?dealer_token=${encodeURIComponent(dealerToken)}&customer_name=${encodeURIComponent(customerName)}&hours=2`);
      if (recentResp.ok) {
        const { notes } = await recentResp.json();
        if (notes && notes.length > 0) {
          const priorContext = notes.map((n: any) => {
            const time = new Date(n.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const noteText = (n.output || '').substring(0, 200);
            return `[${time}] ${noteText}`;
          }).join('\n');
          userMessage += `\n\nPRIOR NOTES ON THIS CUSTOMER (last 2 hours):\n${priorContext}\n\nDO NOT repeat information from prior notes. Only generate new content if there is new information. For the CRM NOTE specifically: if nothing has changed since the last note, respond with exactly "NO_NEW_NOTE" for the CRM NOTE section.`;
        }
      }
    } catch(e) {
      // Silent fail — dedup is nice-to-have, not blocking
    }
  }

  // Structured metadata for generation_events logging (sent alongside the prompt)
  const metadata = {
    rep_name: finalRepName,
    workflow_type: payload.metadata?.workflow_type || payload.type || 'all',
    customer_name: customerName,
    vehicle: payload.metadata?.vehicle || payload.leadContext?.vehicle || null
  };

  const result = await generateViaProxy(dealerToken, userMessage, detectedPlatform, metadata);
  text = result.text;
  usage = result.usage;

  const sections = parseSections(text);

  return { text, sections };
}

// --- Generate via Proxy ---
// Does NOT send system prompt — proxy resolves it from dealer's vertical_config
async function generateViaProxy(dealerToken: string, userMessage: string, platform: string = 'chrome_extension', metadata?: any) {
  const body = {
    dealer_token: dealerToken,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 800,
    model: 'claude-sonnet-4-20250514',
    platform: platform,
    // Structured metadata for accurate generation_events logging
    rep_name: metadata?.rep_name || null,
    workflow_type: metadata?.workflow_type || null,
    customer_name: metadata?.customer_name || null,
    vehicle: metadata?.vehicle || null
  };

  // Use signedFetch for HMAC-signed requests (falls back to unsigned if no secret yet)
  const resp = await signedFetch(`${PROXY_URL}/v1/generate`, body);

  if (resp.status === 401) throw new Error('License invalid or expired. Contact support to renew your Brevmont subscription.');
  if (resp.status === 429) throw new Error('Too many requests. Wait a few seconds and try again.');
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errBody.error || `Proxy error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response from AI. Please try again.');

  return { text, usage: data.usage || {} };
}

// --- Generate Direct (fallback — uses local SYSTEM_PROMPT) ---
// --- Coach via Proxy ---
async function handleCoach(payload: { situation: string; vehicleContext?: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
  const resp = await fetch(`${PROXY_URL}/api/coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      situation: payload.situation,
      rep_name: settings.rep_name || '',
      dealership: settings.dealership || '',
      vehicle_context: payload.vehicleContext || '',
      dealer_token: settings.dealer_token || ''
    })
  });
  if (!resp.ok) throw new Error('Coach unavailable. Try again.');
  const data = await resp.json();
  return { coaching: data.coaching };
}

// --- Command Mode via Proxy ---
async function handleCommand(payload: { command: string; currentUrl?: string; vehicleContext?: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
  const resp = await fetch(`${PROXY_URL}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: payload.command,
      current_url: payload.currentUrl || '',
      rep_name: settings.rep_name || '',
      dealership: settings.dealership || '',
      customer_context: null,
      dealer_token: settings.dealer_token || ''
    })
  });
  if (!resp.ok) throw new Error('Command service unavailable. Try again.');
  const data = await resp.json();
  if (data.error) throw new Error(data.error);

  // Logging handled server-side in proxy — no double logging

  return data;
}

// ===== CONTEXT REPLY (screenshot vision) =====
async function handleContextReply(payload: { image: string; direction: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name']);
  const dealerToken = settings.dealer_token || '';
  if (!dealerToken) throw new Error('No license key found.');

  // Try dedicated endpoint first
  try {
    const resp = await fetch(`${PROXY_URL}/api/context-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealer_token: dealerToken,
        image: payload.image,
        direction: payload.direction,
        rep_name: settings.rep_name || 'Unknown'
      })
    });

    if (resp.status === 401) throw new Error('License invalid or expired.');
    if (resp.status === 413) throw new Error('Screenshot too large — try a smaller crop');
    if (resp.status === 429) throw new Error('Too many requests. Wait a few seconds.');
    // If 403 (tier gate) or other error, fall through to vision fallback
    if (resp.ok) return await resp.json();
  } catch(e: any) {
    if (e.message.includes('License') || e.message.includes('Too many')) throw e;
    // Fall through to fallback
  }

  // Fallback: use /v1/generate with vision content blocks
  const imageMediaType = payload.image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const base64Data = payload.image.replace(/^data:image\/\w+;base64,/, '');

  const resp = await fetch(`${PROXY_URL}/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dealer_token: dealerToken,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: base64Data } },
          { type: 'text', text: `Look at this screenshot of a conversation. ${payload.direction}\n\nGenerate a natural reply based on what you see in the screenshot. Keep it conversational and direct.` }
        ]
      }],
      max_tokens: 800,
      model: 'claude-sonnet-4-20250514',
      platform: 'context_reply'
    })
  });

  if (resp.status === 413) throw new Error('Screenshot too large — try a smaller crop');
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `Server error ${resp.status}` }));
    throw new Error(errBody.error || `Error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response. Try again.');
  return { reply: text };
}

// ===== VOICE REPLY (transcription → generate) =====
async function handleVoiceReply(payload: { transcription: string }) {
  const settings = await browser.storage.sync.get(['dealer_token']);
  const { repName, dealership, contextBlock } = await buildRepContext();
  const dealerToken = settings.dealer_token || '';
  if (!dealerToken) throw new Error('No license key found.');

  const voiceMessage = `[Voice dictation — clean up filler words and extract intent]\nRep said: "${payload.transcription}"\nGenerate a professional text message reply based on their intent. Keep it 2-3 sentences max.`;

  const metadata = {
    rep_name: repName,
    workflow_type: 'voice_reply',
    customer_name: null,
    vehicle: null
  };

  const result = await generateViaProxy(dealerToken, `${contextBlock}\nRep: ${repName}\nDealership: ${dealership}\n\n${voiceMessage}`, 'voice', metadata);
  const sections = parseSections(result.text);
  return { text: result.text, sections };
}

// ===== ERROR REPORTING =====
async function reportError(errorType: string, errorMessage: string) {
  try {
    const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
    if (!settings.dealer_token) return;
    const manifest = browser.runtime.getManifest();
    let platform = 'unknown';
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.url) platform = new URL(tabs[0].url).hostname;
    } catch(e) {}
    await fetch(`${PROXY_URL}/api/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: settings.dealer_token,
        rep_name: settings.rep_name || 'Unknown',
        dealership: settings.dealership || '',
        error_type: errorType,
        error_message: errorMessage.slice(0, 500),
        extension_version: manifest.version || '1.7.0',
        platform: platform
      })
    });
  } catch(e) { /* silent — don't recurse */ }
}

// ===== FEATURE GATING =====
function getTierFeatures(tier: string) {
  // Normalize legacy tier names
  if (tier === 'core') tier = 'floor';
  if (tier === 'pro') tier = 'command';
  if (tier === 'elite') tier = 'group';

  const base: Record<string, boolean> = {
    vinsolutions: true,
    generation: true,
    basic_logging: true,
    gm_dashboard: false,
    ghost_leads: false,
    rep_leaderboard: false,
    objection_tracking: false,
    facebook: false,
    gmail: false,
    linkedin: false,
    voice_coach: false,
    command_mode: false,
    context_reply: false,
    voice_dictation: false,
    campaigns: false,
    multi_location: false,
    owner_dashboard: false,
    priority_support: false,
    automated_reactivation: false
  };

  if (tier === 'command' || tier === 'group') {
    base.gm_dashboard = true;
    base.ghost_leads = true;
    base.rep_leaderboard = true;
    base.objection_tracking = true;
    base.facebook = true;
    base.gmail = true;
    base.linkedin = true;
    base.voice_coach = true;
    base.command_mode = true;
    base.context_reply = true;
    base.voice_dictation = true;
  }

  if (tier === 'group') {
    base.campaigns = true;
    base.multi_location = true;
    base.owner_dashboard = true;
    base.priority_support = true;
    base.automated_reactivation = true;
  }

  return base;
}

function buildUserMessage(payload: any, repName: string, dealership: string, repContext: string = ''): string {
  const lc = payload.leadContext || {};
  let msg = '';

  // Inject rep context block at the top of every prompt
  if (repContext) {
    msg += repContext + '\n';
  }

  if (lc.customerName || lc.vehicle) {
    msg += 'LEAD CONTEXT (from CRM):\n';
    if (lc.customerName) msg += `Customer: ${lc.customerName}\n`;
    if (lc.phone) msg += `Phone: ${lc.phone}\n`;
    if (lc.email) msg += `Email: ${lc.email}\n`;
    if (lc.vehicle) msg += `Vehicle: ${lc.vehicle}\n`;
    if (lc.source) msg += `Source: ${lc.source}\n`;
    if (lc.status) msg += `Status: ${lc.status}\n`;
    if (lc.lastContact) msg += `Last contact: ${lc.lastContact}\n`;
    if (lc.lastNote) msg += `Last note: ${lc.lastNote}\n`;
    if (lc.notes?.length) {
      msg += `\nNOTES HISTORY (${lc.notes.length} entries):\n`;
      lc.notes.slice(0, 10).forEach((n: any) => {
        msg += `[${n.date || 'unknown'}] ${n.content || n.text || ''}\n`;
      });
    }
    msg += '\n';
  }

  msg += `Rep: ${repName}\nDealership: ${dealership}\n\n`;

  if (payload.type === 'all') {
    msg += `REP VOICE/TYPED INPUT:\n${payload.repInput}\n\n`;
    msg += 'Generate ALL THREE outputs. You MUST produce all three labeled sections:\n';
    msg += '1. TEXT (2-3 sentences max, no exclamation points, end with a question)\n';
    msg += '2. EMAIL (subject + 3-4 sentence body + signature)\n';
    msg += '3. CRM NOTE (plain text: date, contact type, summary, vehicle, intent, action, next step, notes)\n';
    msg += 'Label each section clearly as TEXT, EMAIL, and CRM NOTE. Do not skip any section.\n';
  } else if (payload.type === 'text') {
    msg += `Generate a TEXT MESSAGE. CRITICAL: 2-3 sentences MAXIMUM. No more. End with one question. No exclamation points. No filler.\n`;
    if (payload.repInput) msg += `Context: ${payload.repInput}\n`;
  } else if (payload.type === 'email') {
    msg += `Generate an EMAIL.\n`;
    if (payload.repInput) msg += `Context: ${payload.repInput}\n`;
  } else if (payload.type === 'crm') {
    msg += `Generate a CRM NOTE.\n`;
    if (payload.repInput) msg += `Context: ${payload.repInput}\n`;
  } else {
    msg += payload.repInput || 'Generate TEXT + EMAIL + CRM NOTE.\n';
  }

  return msg;
}

function parseSections(text: string) {
  const textMatch = text.match(/(?:^|\n)TEXT(?:\s*MESSAGE)?\s*\n([\s\S]*?)(?=\n(?:EMAIL|CRM)|$)/i);
  const emailMatch = text.match(/(?:^|\n)EMAIL(?:\s*REPLY)?\s*\n([\s\S]*?)(?=\n(?:TEXT|CRM)|$)/i);
  const crmMatch = text.match(/(?:^|\n)CRM(?: NOTE)?\s*\n([\s\S]*)$/i);

  return {
    text: textMatch?.[1]?.trim() || '',
    email: emailMatch?.[1]?.trim() || '',
    crm: crmMatch?.[1]?.trim() || '',
    raw: text,
  };
}
