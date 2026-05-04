/**
 * Brevmont Background Service Worker
 *
 * ALL generation goes through Railway proxy. No direct API calls.
 * No API keys in this file. Proxy owns the Anthropic key and system prompt.
 * Every generation event includes platform field.
 */

// No SYSTEM_PROMPT in extension — proxy resolves from vertical_config.
// No API keys in extension — all calls routed through PROXY_URL.

const PROXY_URL = 'https://api.brevmont.com';

import { signedFetch, signedGet } from '../lib/authSigning';
import { enqueue, processQueue, getQueueCount as getDexieQueueCount } from '../lib/retryQueue';
import { telemetry } from './lib/telemetry';
import { dlog } from './lib/dev';
import { initSentry, setSentryContext, captureError, addBreadcrumb } from '../lib/sentry';
import { fetchRemoteConfig, getResolvedApiUrl, applyConfig } from '../lib/remoteConfig';

initSentry();

export default defineBackground(() => {
  // One-time migration: brevmont_ → brevmont_ storage keys
  (async () => {
    const migrated = await browser.storage.local.get('brevmont_storage_migrated');
    if (migrated.brevmont_storage_migrated) return;

    const oldKeys = await browser.storage.local.get(['brevmont_tier', 'brevmont_features', 'brevmont_last_heartbeat', 'brevmont_alerts']);
    const newData: Record<string, any> = { brevmont_storage_migrated: true };
    if (oldKeys.brevmont_tier) newData.brevmont_tier = oldKeys.brevmont_tier;
    if (oldKeys.brevmont_features) newData.brevmont_features = oldKeys.brevmont_features;
    if (oldKeys.brevmont_last_heartbeat) newData.brevmont_last_heartbeat = oldKeys.brevmont_last_heartbeat;
    if (oldKeys.brevmont_alerts) newData.brevmont_alerts = oldKeys.brevmont_alerts;
    await browser.storage.local.set(newData);
    await browser.storage.local.remove(['brevmont_tier', 'brevmont_features', 'brevmont_last_heartbeat', 'brevmont_alerts']);

    const oldSync = await browser.storage.sync.get(['brevmont_tone', 'brevmont_goal']);
    const newSync: Record<string, any> = {};
    if (oldSync.brevmont_tone) newSync.brevmont_tone = oldSync.brevmont_tone;
    if (oldSync.brevmont_goal) newSync.brevmont_goal = oldSync.brevmont_goal;
    if (Object.keys(newSync).length) {
      await browser.storage.sync.set(newSync);
      await browser.storage.sync.remove(['brevmont_tone', 'brevmont_goal']);
    }

    dlog('[Brevmont] Storage migration complete');
  })().catch(() => {});

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Health check — content script pings to verify service worker is alive
    if (msg.type === 'PING') { sendResponse({ pong: true }); return false; }

    if (msg.type === 'GET_SYNC_QUEUE_COUNT') {
      getDexieQueueCount().then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
      return true;
    }

    if (msg.type === 'SUPPORT_REPORT') {
      (async () => {
        try {
          const sync = await browser.storage.sync.get(['dealer_token', 'rep_name']);
          if (!sync.dealer_token) {
            sendResponse({ ok: false, error: 'not_configured' });
            return;
          }
          const local = await browser.storage.local.get([
            'brevmont_recent_errors',
            'brevmont_last_heartbeat',
            'brevmont_last_error',
            'brevmont_last_error_at',
          ]);
          const apiUrl = (await getResolvedApiUrl()).replace(/\/$/, '');
          const manifest = browser.runtime.getManifest();
          const cm = typeof navigator !== 'undefined' ? navigator.userAgent?.match(/Chrome\/([\d.]+)/) : null;
          const diagnostics = {
            extension_version: manifest.version || '',
            chrome_version: cm ? cm[1] : 'unknown',
            last_errors: (local.brevmont_recent_errors as string[]) || [],
            last_error: local.brevmont_last_error || null,
            last_error_at: local.brevmont_last_error_at || null,
            queue_count: await getDexieQueueCount(),
            network_online: typeof navigator !== 'undefined' ? navigator.onLine : true,
            last_heartbeat_ms: local.brevmont_last_heartbeat || null,
            tab_domain: (msg.payload as any)?.tab_domain || null,
          };
          const r = await fetch(`${apiUrl}/api/support-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dealer_token: sync.dealer_token,
              rep_name: sync.rep_name || '',
              user_description: (msg.payload as any)?.note || '',
              diagnostics,
            }),
          });
          sendResponse({ ok: r.ok });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    if (msg.type === 'REPORT_ERROR') {
      const { error_type, error_message, context } = msg.payload || {};
      reportError(error_type || 'UNKNOWN', `[content] ${(error_message || 'unknown error').slice(0, 400)}${context ? ` | ctx: ${context}` : ''}`).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'GENERATE_OUTPUT') {
      (async () => {
        try {
          addBreadcrumb('generation', 'User requested generation', { scenario: msg.payload?.type });
          const result = await handleGenerate(msg.payload);
          addBreadcrumb('generation', 'API response received', { queued: !!(result as any)?.queued });
          const apiUrl = await getResolvedApiUrl();
          await processQueue(apiUrl).catch(() => {});
          if ((result as any)?.queued) {
            sendResponse({
              queued: true,
              message: (result as any).message,
              error: (result as any).message,
              queue_id: (result as any).queue_id,
            });
          } else {
            sendResponse(result);
          }
        } catch (err: any) {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('429') ? 'API_ERROR'
            : 'UNKNOWN';
          captureError(err instanceof Error ? err : new Error(String(err?.message || err)), { flow: 'GENERATE_OUTPUT', errType });
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    if (msg.type === 'CHECK_FEATURES') {
      browser.storage.local.get(['brevmont_tier', 'brevmont_features', 'brevmont_last_heartbeat']).then(data => {
        const stale = !data.brevmont_last_heartbeat || (Date.now() - data.brevmont_last_heartbeat > 30 * 60 * 1000);
        const tier = stale ? 'floor' : (data.brevmont_tier || 'floor');
        sendResponse({ tier, features: data.brevmont_features || getTierFeatures(tier) });
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
      browser.storage.local.get(['dealer_token', 'rep_id']).then(async (local) => {
        let dealerToken = (local.dealer_token as string) || '';
        if (!dealerToken) {
          const sync = await browser.storage.sync.get(['dealer_token']);
          dealerToken = (sync.dealer_token as string) || '';
        }
        if (!dealerToken) return;
        const ACTION_MAP: Record<string, string> = {
          GENERATE: 'crm.generation', PASTE: 'crm.paste',
          SEND: 'crm.send', CONFIRM: 'crm.confirm',
        };
        const event_type = ACTION_MAP[(p.action_type || '').toUpperCase()] || 'crm.generation';
        try {
          await fetch(`${PROXY_URL}/api/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dealerToken}` },
            body: JSON.stringify({
              event_type,
              rep_id: (local.rep_id as string) || null,
              payload: { customer: p.customer || null, vehicle: p.vehicle || null, platform: p.platform || 'unknown' },
              idempotency_key: crypto.randomUUID(),
            }),
          });
        } catch(e: any) {
          console.error('[Brevmont] Log action failed:', e);
          telemetry.trackError(e, { flow: 'log_action' });
          reportError('API_ERROR', `Log action failed: ${e?.message || 'unknown'}`).catch(() => {});
        }
      });
      return false;
    }

    if (msg.type === 'LOG_COPY') {
      const p = msg.payload;
      browser.storage.local.get(['dealer_token', 'rep_id']).then(async (local) => {
        let dealerToken = (local.dealer_token as string) || '';
        if (!dealerToken) {
          const sync = await browser.storage.sync.get(['dealer_token']);
          dealerToken = (sync.dealer_token as string) || '';
        }
        if (!dealerToken) return;
        const label = (p.label || 'COPY').toUpperCase();
        const LABEL_MAP: Record<string, string> = {
          LEAD_CAPTURED: 'crm.generation', EMAIL_QUEUED: 'crm.send',
          EMAIL_APPLIED: 'crm.paste', CRM_NOTE_QUEUED: 'crm.paste',
        };
        const event_type = LABEL_MAP[label] || 'crm.paste';
        try {
          await fetch(`${PROXY_URL}/api/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dealerToken}` },
            body: JSON.stringify({
              event_type,
              rep_id: (local.rep_id as string) || null,
              payload: { customer: p.customer || null, vehicle: p.vehicle || null, platform: p.platform || 'unknown', label: p.label || 'COPY' },
              idempotency_key: crypto.randomUUID(),
            }),
          });
        } catch(e: any) {
          console.error('[Brevmont] Log copy failed:', e);
          telemetry.trackError(e, { flow: 'log_copy' });
        }
      });
      return false;
    }

    if (msg.type === 'OPEN_ONBOARDING') {
      browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') });
      return false;
    }

    if (msg.type === 'OPEN_URL') {
      // Content scripts route outbound link opens through here so popup
      // blockers and mixed-content rules on CRM hosts don't swallow the
      // click. Only allow known Brevmont origins — never open arbitrary URLs.
      const url = msg.payload?.url || '';
      if (typeof url === 'string' && /^https:\/\/[a-z0-9.-]+\.brevmont\.com\//.test(url)) {
        browser.tabs.create({ url }).catch(() => {});
      }
      return false;
    }

    if (msg.type === 'MARK_OUTCOME') {
      (async () => {
        try {
          const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
          const resp = await signedFetch(`${PROXY_URL}/api/outcome`, {
            dealer_token: settings.dealer_token || '',
            customer_name: msg.payload.customer_name || '',
            outcome: msg.payload.outcome,
            rep_name: settings.rep_name || '',
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed' }));
            sendResponse({ error: err.error || `Error ${resp.status}` });
          } else {
            const data = await resp.json();
            sendResponse(data);
          }
        } catch (e: any) {
          telemetry.trackError(e, { flow: 'mark_outcome' });
          sendResponse({ error: e.message || 'Network error' });
        }
      })();
      return true;
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
      browser.storage.local.get('brevmont_alerts').then(data => {
        const alerts = data.brevmont_alerts || [];
        alerts.push({ id: Date.now().toString(), task: msg.payload.task, alertTime: msg.payload.alertTime, dismissed: false });
        browser.storage.local.set({ brevmont_alerts: alerts }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ error: 'Failed to set alert' }));
      return true;
    }

    if (msg.type === 'DISMISS_ALERT') {
      browser.storage.local.get('brevmont_alerts').then(data => {
        const alerts = data.brevmont_alerts || [];
        const updated = alerts.map((a: any) => a.id === msg.payload.id ? { ...a, dismissed: true } : a);
        browser.storage.local.set({ brevmont_alerts: updated }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === 'GET_ALERTS') {
      browser.storage.local.get('brevmont_alerts').then(data => {
        const alerts = data.brevmont_alerts || [];
        sendResponse(alerts.filter((a: any) => !a.dismissed));
      }).catch(() => sendResponse([]));
      return true;
    }

    // --- Pending Notes ---
    if (msg.type === 'SAVE_PENDING_NOTE') {
      browser.storage.sync.get(['dealer_token', 'rep_name']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ error: 'No dealer_token' }); return; }
        try {
          const resp = await signedFetch(`${PROXY_URL}/api/pending-notes`, {
            dealer_token: settings.dealer_token, rep_name: settings.rep_name || '', customer_name: msg.payload.customer_name || '', contact_id: msg.payload.contact_id || null, note_text: msg.payload.note_text
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { telemetry.trackError(e, { flow: 'save_pending_note' }); sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'GET_PENDING_NOTES') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ notes: [] }); return; }
        try {
          // Proxy reads dealer_token from Authorization header (req.headers['authorization']
          // OR req.query.dealer_token). We send via header only so the token never
          // lands in access logs, browser history, or CDN caches.
          const resp = await fetch(`${PROXY_URL}/api/pending-notes`, {
            headers: { 'Authorization': `Bearer ${settings.dealer_token}` }
          });
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
          const resp = await signedFetch(`${PROXY_URL}/api/pending-emails`, {
            dealer_token: settings.dealer_token, rep_name: settings.rep_name || '', customer_name: msg.payload.customer_name || '', subject: msg.payload.subject || '', body: msg.payload.body || ''
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { telemetry.trackError(e, { flow: 'save_pending_email' }); sendResponse({ error: e.message }); }
      });
      return true;
    }

    if (msg.type === 'GET_PENDING_EMAILS') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ emails: [] }); return; }
        try {
          const resp = await fetch(`${PROXY_URL}/api/pending-emails`, {
            headers: { 'Authorization': `Bearer ${settings.dealer_token}` }
          });
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
          const resp = await signedFetch(`${PROXY_URL}/api/parse-lead`, {
            dealer_token: settings.dealer_token, raw_text: msg.payload.raw_text, platform: msg.payload.platform || 'unknown'
          });
          const data = await resp.json();
          sendResponse(data);
        } catch(e: any) { telemetry.trackError(e, { flow: 'parse_lead' }); sendResponse({ error: e.message }); }
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

    // ===== Intelligence: Edit-distance telemetry =====
    if (msg.type === 'TELEMETRY_EDIT_DISTANCE') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ ok: false }); return; }
        try {
          await fetch(`${PROXY_URL}/api/telemetry/edit-distance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.dealer_token}` },
            body: JSON.stringify(msg.payload),
          });
          sendResponse({ ok: true });
        } catch (e: any) {
          telemetry.trackError(e, { flow: 'edit_distance' });
          sendResponse({ ok: false });
        }
      });
      return true;
    }

    // ===== Intelligence: DOM discovery telemetry =====
    if (msg.type === 'TELEMETRY_DOM_DISCOVERY') {
      browser.storage.sync.get(['dealer_token']).then(async (settings) => {
        if (!settings.dealer_token) { sendResponse({ ok: false }); return; }
        try {
          await fetch(`${PROXY_URL}/api/telemetry/dom-discovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.dealer_token}` },
            body: JSON.stringify(msg.payload),
          });
          sendResponse({ ok: true });
        } catch (e: any) {
          telemetry.trackError(e, { flow: 'dom_discovery' });
          sendResponse({ ok: false });
        }
      });
      return true;
    }
  });

  // ===== HEARTBEAT + ALERTS via chrome.alarms (MV3 compliant) =====
  async function queryCrmPageContextForHeartbeat(): Promise<string> {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) return 'unknown';
      return await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('unknown'), 2000);
        browser.tabs
          .sendMessage(tab.id!, { type: 'GET_CRM_PAGE_CONTEXT' })
          .then((r: any) => {
            clearTimeout(timer);
            resolve(typeof r?.context === 'string' ? r.context : 'unknown');
          })
          .catch(() => {
            clearTimeout(timer);
            resolve('unknown');
          });
      });
    } catch {
      return 'unknown';
    }
  }

  async function sendHeartbeatV2(apiUrl: string): Promise<void> {
    const settings = await browser.storage.sync.get(['dealer_token', 'rep_name']);
    if (!settings.dealer_token) return;
    const local = await browser.storage.local.get([
      'brevmont_last_error',
      'brevmont_last_error_at',
      'dealership_id',
      'pending_heartbeats',
    ]);
    const manifest = browser.runtime.getManifest();
    const chromeMatch = (typeof navigator !== 'undefined' && navigator.userAgent)
      ? navigator.userAgent.match(/Chrome\/([\d.]+)/)
      : null;
    const memMb =
      typeof performance !== 'undefined' &&
      (performance as any).memory?.usedJSHeapSize != null
        ? Math.round(((performance as any).memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
        : null;
    const queueCount = await getDexieQueueCount();
    const crmCtx = await queryCrmPageContextForHeartbeat();
    const body = {
      dealer_token: settings.dealer_token,
      rep_name: settings.rep_name || 'Unknown',
      extension_version: manifest.version || '1.8.0',
      chrome_version: chromeMatch ? chromeMatch[1] : 'unknown',
      last_error: (local.brevmont_last_error as string) || null,
      last_error_at: (local.brevmont_last_error_at as string) || null,
      unsynced_queue_count: queueCount,
      network_status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
      crm_page_context: crmCtx,
      memory_usage_mb: memMb,
    };
    const base = apiUrl.replace(/\/$/, '');
    const postOne = async (payload: object) => {
      const r = await signedFetch(`${base}/api/heartbeat/v2`, payload);
      return r.ok;
    };
    try {
      const pending = Array.isArray(local.pending_heartbeats)
        ? [...(local.pending_heartbeats as object[])]
        : [];
      let i = 0;
      for (; i < pending.length; i++) {
        if (!(await postOne(pending[i]))) {
          await browser.storage.local.set({
            pending_heartbeats: [...pending.slice(i), body].slice(-50),
          });
          return;
        }
      }
      if (!(await postOne(body))) {
        await browser.storage.local.set({ pending_heartbeats: [...pending, body].slice(-50) });
        return;
      }
      await browser.storage.local.remove('pending_heartbeats');
    } catch {
      const nextPending = [
        ...(Array.isArray(local.pending_heartbeats) ? (local.pending_heartbeats as object[]) : []),
        body,
      ].slice(-50);
      await browser.storage.local.set({ pending_heartbeats: nextPending });
    }
  }

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
      const apiUrl = await getResolvedApiUrl();
      try {
        const loc = await browser.storage.local.get(['dealership_id']);
        setSentryContext(
          String(loc.dealership_id || ''),
          String(settings.rep_name || 'Unknown')
        );
      } catch {
        /* noop */
      }
      const resp = await signedFetch(`${apiUrl}/api/heartbeat`, {
        license_key: settings.dealer_token,
        rep_name: settings.rep_name || 'Unknown',
        dealership: settings.dealership || '',
        extension_version: manifest.version || '1.8.0',
        platform: platform,
        timestamp: new Date().toISOString()
      });
      if (resp.ok) {
        const data = await resp.json();
        const tier = data.tier || 'floor';
        await browser.storage.local.set({
          brevmont_tier: tier,
          brevmont_features: data.features || getTierFeatures(tier),
          brevmont_last_heartbeat: Date.now(),
        });
        const qSize = await getDexieQueueCount();
        if (qSize > 0) {
          await processQueue(apiUrl).catch(() => {});
        }
        await sendHeartbeatV2(apiUrl).catch(() => {});
      }
    } catch(e) {
      reportError('NETWORK_ERROR', `Heartbeat failed: ${(e as Error).message}`).catch(() => {});
    }
  }

  async function checkAlerts() {
    const data = await browser.storage.local.get('brevmont_alerts');
    const alerts = data.brevmont_alerts || [];
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
    if (changed) await browser.storage.local.set({ brevmont_alerts: alerts });
  }

  // Default alarms — survives service worker restarts (intervals overridden by remote config when loaded)
  browser.alarms.create('brevmont-heartbeat', { periodInMinutes: 5 });
  browser.alarms.create('brevmont-check-alerts', { periodInMinutes: 0.5 });
  browser.alarms.create('brevmont-queue-flush', { periodInMinutes: 1 });
  browser.alarms.create('brevmont-config-refresh', { periodInMinutes: 60 });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'brevmont-heartbeat') void sendHeartbeat();
    else if (alarm.name === 'brevmont-check-alerts') void checkAlerts();
    else if (alarm.name === 'brevmont-queue-flush') {
      void getResolvedApiUrl().then((u) => processQueue(u).catch(() => {}));
    } else if (alarm.name === 'brevmont-config-refresh') {
      void getResolvedApiUrl().then(async (apiUrl) => {
        const cfg = await fetchRemoteConfig(apiUrl);
        if (cfg) {
          applyConfig(cfg);
          try {
            const v = await browser.storage.local.get('brevmont_config_version');
            addBreadcrumb('config', 'Remote config fetched', { version: v.brevmont_config_version });
          } catch {
            addBreadcrumb('config', 'Remote config fetched', {});
          }
        }
      });
    }
  });

  try {
    self.addEventListener('online', () => {
      void getResolvedApiUrl().then((u) => processQueue(u).catch(() => {}));
    });
    self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      captureError(new Error(`Unhandled rejection: ${event.reason}`), { type: 'unhandled_rejection' });
    });
    self.addEventListener('error', (event: ErrorEvent) => {
      captureError(event.error || new Error(event.message), {
        type: 'uncaught_error',
        filename: event.filename,
        lineno: event.lineno,
      });
    });
  } catch {
    /* noop */
  }

  void getResolvedApiUrl().then(async (apiUrl) => {
    const cfg = await fetchRemoteConfig(apiUrl);
    if (cfg) applyConfig(cfg);
  });

  // Fire initial heartbeat after 10 seconds
  setTimeout(sendHeartbeat, 10000);

  // ===== AUTH HARDENING: Self-heal sync.dealer_token for pre-fix installs =====
  // Context: prior versions of entrypoints/onboarding/main.ts wrote the raw
  // human license_key (e.g. TEST-B34BD25E-6CF7EF7E) into sync.dealer_token at
  // finish(). authSigning.getLicenseCredentials reads that value as the
  // X-Brevmont-License-Key header. On a Phase 2 dealership the proxy's
  // lookupLicenseKey resolves it to dealerships.license_secret, while the
  // extension signs with dealer_tokens.license_secret — HMAC mismatch, every
  // signed request 401s. The onboarding flow now writes the dtk_ UUID
  // instead, but existing installs still carry the bad value. This heal runs
  // once on startup and swaps the value if local holds the correct one.
  async function healDealerTokenSync() {
    try {
      const sync = await browser.storage.sync.get(['dealer_token']);
      const local = await browser.storage.local.get(['dealer_token']);
      const syncVal = sync?.dealer_token as string | undefined;
      const localVal = local?.dealer_token as string | undefined;
      // Heal only when local holds a dtk_-prefixed session token and sync
      // still has the human license_key. Never overwrite a valid dtk_ sync.
      if (localVal && localVal.startsWith('dtk_') && syncVal && !syncVal.startsWith('dtk_')) {
        await browser.storage.sync.set({ dealer_token: localVal });
        // The stale license_secret was bootstrapped with license_key=TEST-...
        // and (pre-proxy-fix) holds dealerships.license_secret, which does not
        // match the dealer_tokens.license_secret that the server verifies
        // against. Clear it so bootstrapLicenseSecret re-fetches with the
        // dtk_ value + post-fix server returns the unified secret.
        await browser.storage.local.remove(['brevmont_license_secret']);
        dlog('[Brevmont] healed sync.dealer_token and cleared stale license_secret');
      }
    } catch (err) {
      console.warn('[Brevmont] dealer_token heal error:', (err as Error).message);
    }
  }

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
        dlog('[Brevmont] License secret bootstrapped successfully');
      }
    } catch (err) {
      console.warn('[Brevmont] License secret bootstrap error:', (err as Error).message);
    }
  }

  // ===== AUTO-CONFIG: Cookie-share handoff from app.brevmont.com =====
  // After the rep claims a seat at /join/:id/complete, the page sets the
  // brevmont_rep_session cookie on .brevmont.com with the per-rep token.
  // On extension install (or first run with no creds), we read that cookie,
  // call GET /api/session/to-license, and populate chrome.storage with the
  // license + rep credentials silently. The legacy 4-step wizard at
  // entrypoints/onboarding/main.ts is still mounted as a fallback for the
  // path where the cookie isn't there or auto-config fails.
  async function tryCookieShareAutoConfig(): Promise<boolean> {
    try {
      // Feature flag: founder can flip this off via storage if auto-config
      // misbehaves in production. Defaults to enabled.
      const flagState = await browser.storage.local.get(['BREVMONT_AUTO_CONFIG_ENABLED']);
      if (flagState.BREVMONT_AUTO_CONFIG_ENABLED === false) return false;

      // Existing rep with credentials? Don't disturb them.
      const existingSync = await browser.storage.sync.get(['dealer_token']);
      if (existingSync.dealer_token) return false;

      // Read the cookie set by /join/:id/complete on app.brevmont.com.
      const cookie = await browser.cookies.get({
        url: 'https://app.brevmont.com',
        name: 'brevmont_rep_session',
      });
      if (!cookie?.value) return false;

      const repAuthToken = cookie.value;
      const resp = await fetch(`${PROXY_URL}/api/session/to-license`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${repAuthToken}` },
      });
      if (!resp.ok) {
        console.warn('[Brevmont] auto-config bridge returned', resp.status);
        return false;
      }
      const data = await resp.json() as {
        license_key?: string;
        license_secret?: string;
        dealer_token?: string;
        rep_auth_token?: string;
        dealership_id?: string;
        dealership_name?: string;
        rep_email?: string;
        rep_name?: string;
      };
      if (!data.license_key || !data.license_secret) return false;

      // Sync storage holds the values authSigning + heartbeat read from.
      await browser.storage.sync.set({
        dealer_token: data.dealer_token || data.license_key,
        rep_name: data.rep_name || data.rep_email || 'Rep',
        dealership: data.dealership_name || '',
      });
      // Local storage holds the secret + rep_auth_token used by signedFetch.
      await browser.storage.local.set({
        brevmont_license_secret: data.license_secret,
        license_secret: data.license_secret,
        rep_auth_token: data.rep_auth_token || repAuthToken,
        brevmont_rep_auth_token: data.rep_auth_token || repAuthToken,
        dealership_id: data.dealership_id || '',
        rep_email: data.rep_email || '',
      });
      dlog('[Brevmont] auto-config from cookie share complete:', data.dealership_name);
      return true;
    } catch (err) {
      console.warn('[Brevmont] auto-config error:', (err as Error).message);
      return false;
    }
  }

  // Heal sync.dealer_token on startup (runs immediately; idempotent + safe).
  // Must run before the first signed request so authSigning reads the right
  // key. The heal is a no-op when the sync value is already a dtk_ UUID.
  healDealerTokenSync().catch(() => { /* heal failures are non-fatal */ });

  // Auto-config from cookie share. If it succeeds, fire heartbeat right away
  // so the founder gets the ACTIVATED Telegram alert without the 5-min wait.
  // (Browser-startup path; the on-install path is handled below in the
  // merged onInstalled listener.)
  tryCookieShareAutoConfig().then((configured) => {
    if (configured) sendHeartbeat().catch(() => {});
  }).catch(() => {});

  // Bootstrap secret on startup (after heartbeat settles)
  setTimeout(bootstrapLicenseSecret, 15000);

  // ===== ITEM 30: Extension version check =====
  async function checkVersionStatus() {
    try {
      const manifest = browser.runtime.getManifest();
      const chromeMatch = navigator.userAgent.match(/Chrome\/([\d.]+)/);
      const settings = await browser.storage.sync.get(['dealer_token']);

      const resp = await signedFetch(`${PROXY_URL}/v1/heartbeat/version`, {
        dealer_token: settings.dealer_token || '',
        extension_version: manifest.version || '1.9.2',
        chrome_version: chromeMatch ? chromeMatch[1] : 'unknown',
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

  // Single source of truth for onInstalled. Previously two separate listeners
  // raced: one tried cookie auto-config (silent path), the other unconditionally
  // opened the options/onboarding wizard. The wizard would pop up even when
  // the rep had just completed /join and the cookie handoff was about to
  // configure the extension automatically — confusing UX, makes us look amateur.
  //
  // New flow:
  //   1. Run tryCookieShareAutoConfig() and AWAIT the result.
  //   2. If it returned true → handoff worked, fire a heartbeat, skip wizard.
  //   3. If it returned false → no cookie / handoff failed, open wizard as the
  //      fallback bootstrap path (legacy 4-step wizard).
  //   4. Bootstrap license secret + version check fire regardless.
  browser.runtime.onInstalled.addListener(async (details) => {
    let autoConfigured = false;
    try {
      autoConfigured = await tryCookieShareAutoConfig();
    } catch {
      autoConfigured = false;
    }

    if (autoConfigured) {
      // Cookie share landed. Fire heartbeat now so the ACTIVATED Telegram
      // alert lands immediately instead of after the 5-min cron tick.
      sendHeartbeat().catch(() => {});

      // Cookie auto-config means the rep is also seeing the install screen
      // for the first time. Show the "Find Brevmont in Chrome" walkthrough
      // so they can pin the icon — without it, they'll lose the toolbar
      // affordance and assume the extension isn't installed.
      if (details.reason === 'install') {
        try {
          await browser.tabs.create({ url: browser.runtime.getURL('install-screen.html') });
        } catch {
          // ignore; the wizard fallback below would not run anyway because
          // autoConfigured = true
        }
      }
    } else if (details.reason === 'install') {
      // Auto-config didn't land (no cookie, or bridge call failed). Show
      // the "Find Brevmont in Chrome" walkthrough first — same screen the
      // cookie path shows — so the rep pins the icon. After that walkthrough
      // they can click "I pinned it" which routes them to the legacy
      // onboarding wizard (fallback bootstrap path).
      try {
        await browser.tabs.create({ url: browser.runtime.getURL('install-screen.html') });
      } catch {
        // Final fallback — legacy options page direct.
        if (browser.runtime.openOptionsPage) {
          browser.runtime.openOptionsPage();
        } else {
          browser.tabs.create({ url: browser.runtime.getURL('options.html') });
        }
      }
    }

    // Bootstrap secret + version check on install/update regardless of path.
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

// --- License Revocation Helpers (Phase T7) ---
async function handleRevocationResponse(resp: Response): Promise<void> {
  if (resp.status !== 401 && resp.status !== 403) return;
  let body: any = null;
  try {
    // Clone so downstream consumers can still read the body
    body = await resp.clone().json();
  } catch {}
  if (body?.error === 'license_revoked') {
    const msg = body?.message || body?.error_message || 'Your Brevmont license has been revoked. Contact support.';
    try {
      await browser.storage.local.set({
        license_revoked: true,
        license_revoked_at: Date.now(),
        license_revoked_message: msg,
      });
    } catch {}
    try {
      (browser as any).action?.setBadgeText?.({ text: '!' });
      (browser as any).action?.setBadgeBackgroundColor?.({ color: '#DC2626' });
    } catch {}
    try { telemetry.track('license_revoked', { source: 'proxy_401', severity: 'critical', metadata: { status: resp.status } }); } catch {}
  }
}

async function assertNotRevoked(): Promise<void> {
  try {
    const { license_revoked } = await browser.storage.local.get(['license_revoked']);
    if (license_revoked) throw new Error('license_revoked');
  } catch (e: any) {
    if (e?.message === 'license_revoked') throw e;
  }
}

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
  // Phase T7: block generation outright if license is revoked
  await assertNotRevoked();
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_auth_token']);
  const { repName, dealership, contextBlock } = await buildRepContext();

  const finalRepName = payload.repName || repName;
  const finalDealership = payload.dealership || dealership;
  const dealerToken = settings.dealer_token || '';
  // Rep token (per-rep attribution). When present the background attaches
  // X-Rep-Token to every /v1/generate call so the proxy can resolve rep_id
  // deterministically instead of string-matching on rep_name. Legacy rep_name
  // fallback is preserved below for pre-rep-token installs.
  let repAuthToken: string = (settings.rep_auth_token as string | undefined) || '';
  if (!repAuthToken) {
    try {
      const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
      repAuthToken = (local.rep_auth_token as string | undefined)
        || (local.brevmont_rep_auth_token as string | undefined)
        || '';
    } catch {}
  }
  // Local debug marker so we can tell which attribution path fired when
  // inspecting the service worker console during QA. Intentionally terse.
  dlog('[Brevmont] attribution:', repAuthToken ? 'rep_token' : 'legacy_rep_name');
  const detectedPlatform = payload.platform || 'chrome_extension';
  let userMessage = buildUserMessage(payload, finalRepName, finalDealership, contextBlock);

  // All generation goes through Railway proxy — NO direct API calls, NO local keys
  if (!dealerToken) {
    throw new Error('No license key found. Complete onboarding at brevmont.com to activate Brevmont.');
  }

  // Fetch recent notes for same-lead dedup context
  const customerName = payload.metadata?.customer_name || payload.leadContext?.customerName || null;
  if (customerName && customerName !== 'there') {
    try {
      // NOTE: /api/recent-notes is currently 404 on the proxy. The dedup
      // feature silently no-ops when the endpoint is absent. If/when that
      // handler is restored, this call is already sending customer_name
      // via query string and the dealer_token via Authorization header —
      // no further extension change needed.
      const params = new URLSearchParams({ customer_name: customerName, hours: '2' });
      const recentResp = await fetch(`${PROXY_URL}/api/recent-notes?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${dealerToken}` }
      });
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

  const apiBase = await getResolvedApiUrl();
  const idemKey = crypto.randomUUID();
  try {
    const result = await generateViaProxy(
      dealerToken,
      userMessage,
      detectedPlatform,
      metadata,
      repAuthToken,
      idemKey,
      apiBase
    );
    const sections = parseSections(result.text);
    return { text: result.text, sections };
  } catch (err: any) {
    const m = String(err?.message || err);
    const shouldQueue =
      (err instanceof TypeError && m.includes('fetch')) ||
      /Failed to fetch|NetworkError/i.test(m) ||
      /^HTTP_5\d\d$/i.test(m) ||
      m.includes('Connection to AI service failed') ||
      m.includes('Generation timed out');
    if (shouldQueue) {
      const body = buildGenerateProxyBody(dealerToken, userMessage, detectedPlatform, metadata);
      const xh: Record<string, string> = { 'X-Idempotency-Key': idemKey };
      if (repAuthToken) xh['X-Rep-Token'] = repAuthToken;
      const queueId = await enqueue('/v1/generate', 'POST', xh, body);
      addBreadcrumb('queue', 'Request queued offline', { endpoint: '/v1/generate', queueCount: await getDexieQueueCount() });
      return {
        queued: true as const,
        message: m.includes('timed out')
          ? 'Saved locally. Will retry when the server responds.'
          : 'Saved offline. Will sync when connection returns.',
        queue_id: queueId,
      };
    }
    throw err instanceof Error ? err : new Error(m);
  }
}

function buildGenerateProxyBody(
  dealerToken: string,
  userMessage: string,
  platform: string,
  metadata?: {
    rep_name?: string | null;
    workflow_type?: string | null;
    customer_name?: string | null;
    vehicle?: string | null;
  }
) {
  return {
    dealer_token: dealerToken,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 800,
    model: 'claude-sonnet-4-20250514',
    platform: platform,
    rep_name: metadata?.rep_name ?? null,
    workflow_type: metadata?.workflow_type ?? null,
    customer_name: metadata?.customer_name ?? null,
    vehicle: metadata?.vehicle ?? null,
  };
}

// --- Generate via Proxy ---
// Does NOT send system prompt — proxy resolves it from dealer's vertical_config
async function generateViaProxy(
  dealerToken: string,
  userMessage: string,
  platform: string = 'chrome_extension',
  metadata?: any,
  repAuthToken?: string,
  idempotencyKey?: string,
  apiBase: string = PROXY_URL
) {
  const base = apiBase.replace(/\/$/, '');
  const body = buildGenerateProxyBody(dealerToken, userMessage, platform, metadata);

  const extraHeaders: Record<string, string> = {};
  if (repAuthToken) extraHeaders['X-Rep-Token'] = repAuthToken;
  if (idempotencyKey) extraHeaders['X-Idempotency-Key'] = idempotencyKey;
  const mergedExtra = Object.keys(extraHeaders).length ? extraHeaders : undefined;

  const resp = await signedFetch(`${base}/v1/generate`, body, mergedExtra);

  // Phase T7: detect revocation responses
  await handleRevocationResponse(resp);

  if (resp.status === 202) {
    // Async mode — poll for result from BullMQ queue
    const { job_id } = await resp.json();
    const result = await pollForResult(job_id, 30000, base);
    const text = result.content?.[0]?.text || '';
    if (!text) throw new Error('Empty response from AI. Please try again.');
    return { text, usage: result.usage || {} };
  }

  if (resp.status === 401) throw new Error('License invalid or expired. Contact support to renew your Brevmont subscription.');
  if (resp.status === 429) throw new Error('Too many requests. Wait a few seconds and try again.');
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Unknown error' }));
    if (resp.status >= 500) throw new Error(`HTTP_${resp.status}`);
    throw new Error(errBody.error || `Proxy error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response from AI. Please try again.');

  return { text, usage: data.usage || {} };
}

// Poll for async generation result from BullMQ queue
async function pollForResult(jobId: string, maxWait = 30000, apiBase: string = PROXY_URL): Promise<any> {
  const base = apiBase.replace(/\/$/, '');
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      // Signed poll — keeps the auth surface consistent with /v1/generate,
      // so server-side signature enforcement on the status route can be
      // flipped on later without a coordinated client rev.
      const resp = await signedGet(`${base}/v1/generate/status/${jobId}`);
      const data = await resp.json();
      if (data.status === 'completed') return data.data;
      if (data.status === 'failed') throw new Error(data.error || 'Generation failed');
    } catch (e: any) {
      if (e.message && !e.message.includes('fetch')) throw e;
      // Network error during poll — continue polling
    }
  }
  throw new Error('Generation timed out. Please try again.');
}

// --- Generate Direct (fallback — uses local SYSTEM_PROMPT) ---
// --- Coach via Proxy ---
async function handleCoach(payload: { situation: string; vehicleContext?: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
  let resp: Response;
  try {
    resp = await signedFetch(`${PROXY_URL}/api/coach`, {
      situation: payload.situation,
      rep_name: settings.rep_name || '',
      dealership: settings.dealership || '',
      vehicle_context: payload.vehicleContext || '',
      dealer_token: settings.dealer_token || ''
    });
  } catch (e: any) {
    telemetry.trackError(e, { flow: 'coach' });
    throw e;
  }
  await handleRevocationResponse(resp);
  if (!resp.ok) throw new Error('Coach unavailable. Try again.');
  const data = await resp.json();
  return { coaching: data.coaching };
}

// --- Command Mode via Proxy ---
async function handleCommand(payload: { command: string; currentUrl?: string; vehicleContext?: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'dealership']);
  let resp: Response;
  try {
    resp = await signedFetch(`${PROXY_URL}/api/command`, {
      command: payload.command,
      current_url: payload.currentUrl || '',
      rep_name: settings.rep_name || '',
      dealership: settings.dealership || '',
      customer_context: null,
      dealer_token: settings.dealer_token || ''
    });
  } catch (e: any) {
    telemetry.trackError(e, { flow: 'command' });
    throw e;
  }
  await handleRevocationResponse(resp);
  if (!resp.ok) throw new Error('Command service unavailable. Try again.');
  const data = await resp.json();
  if (data.error) throw new Error(data.error);

  // Logging handled server-side in proxy — no double logging

  return data;
}

// ===== CONTEXT REPLY (screenshot vision) =====
async function handleContextReply(payload: { image: string; direction: string }) {
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_name', 'rep_auth_token']);
  const dealerToken = settings.dealer_token || '';
  if (!dealerToken) throw new Error('No license key found.');

  // Rep-token resolution — mirrors handleGenerate. Attached to both the
  // dedicated context-reply endpoint and the /v1/generate vision fallback.
  let repAuthToken: string = (settings.rep_auth_token as string | undefined) || '';
  if (!repAuthToken) {
    try {
      const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
      repAuthToken = (local.rep_auth_token as string | undefined)
        || (local.brevmont_rep_auth_token as string | undefined)
        || '';
    } catch {}
  }
  const repTokenHeader: Record<string, string> | undefined = repAuthToken
    ? { 'X-Rep-Token': repAuthToken }
    : undefined;

  // Try dedicated endpoint first
  try {
    const resp = await signedFetch(`${PROXY_URL}/api/context-reply`, {
      dealer_token: dealerToken,
      image: payload.image,
      direction: payload.direction,
      rep_name: settings.rep_name || 'Unknown'
    }, repTokenHeader);

    await handleRevocationResponse(resp);
    if (resp.status === 401) throw new Error('License invalid or expired.');
    if (resp.status === 413) throw new Error('Screenshot too large — try a smaller crop');
    if (resp.status === 429) throw new Error('Too many requests. Wait a few seconds.');
    // If 403 (tier gate) or other error, fall through to vision fallback
    if (resp.ok) return await resp.json();
  } catch(e: any) {
    if (e.message?.includes('License') || e.message?.includes('Too many')) { telemetry.trackError(e, { flow: 'context_reply_dedicated' }); throw e; }
    telemetry.trackError(e, { flow: 'context_reply_dedicated' });
    // Fall through to fallback
  }

  // Fallback: use /v1/generate with vision content blocks
  const imageMediaType = payload.image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const base64Data = payload.image.replace(/^data:image\/\w+;base64,/, '');

  let resp: Response;
  try {
    resp = await signedFetch(`${PROXY_URL}/v1/generate`, {
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
    }, repTokenHeader);
  } catch (e: any) {
    telemetry.trackError(e, { flow: 'context_reply_vision' });
    throw e;
  }
  await handleRevocationResponse(resp);

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
  const settings = await browser.storage.sync.get(['dealer_token', 'rep_auth_token']);
  const { repName, dealership, contextBlock } = await buildRepContext();
  const dealerToken = settings.dealer_token || '';
  if (!dealerToken) throw new Error('No license key found.');

  // Same rep-token resolution as handleGenerate: sync first, then local dual-write.
  let repAuthToken: string = (settings.rep_auth_token as string | undefined) || '';
  if (!repAuthToken) {
    try {
      const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
      repAuthToken = (local.rep_auth_token as string | undefined)
        || (local.brevmont_rep_auth_token as string | undefined)
        || '';
    } catch {}
  }

  const voiceMessage = `[Voice dictation — clean up filler words and extract intent]\nRep said: "${payload.transcription}"\nGenerate a professional text message reply based on their intent. Keep it 2-3 sentences max.`;

  const metadata = {
    rep_name: repName,
    workflow_type: 'voice_reply',
    customer_name: null,
    vehicle: null
  };

  const voiceBase = await getResolvedApiUrl();
  const result = await generateViaProxy(
    dealerToken,
    `${contextBlock}\nRep: ${repName}\nDealership: ${dealership}\n\n${voiceMessage}`,
    'voice',
    metadata,
    repAuthToken,
    undefined,
    voiceBase
  );
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
