/**
 * Overdrive background controller — the autonomy layer.
 *
 * Owns:
 *   - chrome.alarms keepalive (rearms detector after SW sleep)
 *   - chrome.runtime.onStartup — opens/pins facebook.com if
 *     keep_facebook_open is enabled
 *   - chrome.tabs.onUpdated / onActivated — installs the detector
 *     bridge on facebook.com and messenger.com tabs
 *   - Detection signal debouncer — new inbound from any layer →
 *     scrape thread → orchestrateReply → inject → send
 *   - chrome.notifications for escalations (fallback: setBadgeText)
 *   - Settings cache (loaded from /api/overdrive/settings, refreshed
 *     on the config-refresh alarm)
 *
 * All state is idempotent — installing twice is a no-op.
 */

import type { OrchestratorSettings, OrchestratorDeps, ThreadScrape } from './orchestrator';
import { orchestrateReply, isHeroStage, replayPendingConfirms } from './orchestrator';
import { reportOverdriveDetection } from './apiClient';
import { radarCapture, radarSweepDone } from './radarClient';
import { getOverdriveSettings } from './apiClient';
import { configureSoloTestMode } from './safetyEnvelope';

const SOLO_TEST_MODE_KEY = 'overdrive_solo_test_mode';

async function loadSoloTestModeFromStorage(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get([SOLO_TEST_MODE_KEY]);
    return !!stored?.[SOLO_TEST_MODE_KEY];
  } catch {
    return false;
  }
}

async function broadcastSoloTestModeToTabs(enabled: boolean): Promise<void> {
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    try {
      chrome.tabs.query({ url: ['*://*.facebook.com/*', '*://*.messenger.com/*'] }, (t) => resolve(t || []));
    } catch { resolve([]); }
  });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'OVERDRIVE_SOLO_TEST_MODE_SET', enabled }, () => {
        // Consume runtime.lastError; some tabs may not have the content script.
        void chrome.runtime.lastError;
      });
    } catch { /* noop */ }
  }
}

const KEEPALIVE_ALARM = 'overdrive-keepalive';
const RADAR_SWEEP_ALARM = 'radar-catchup-sweep';
const NOTIFICATION_ID_PREFIX = 'overdrive-escalation-';
const SETTINGS_CACHE_KEY = 'overdrive_settings_cache';
const REP_REPLIES_TODAY_KEY = 'overdrive_rep_replies_today';
const FACEBOOK_HOSTS = /(?:^|\.)(facebook|messenger)\.com$/i;

interface CachedSettings {
  fetchedAt: number;
  master_enabled: boolean;
  dealership_enabled: boolean;
  linked: boolean;
  disclosure_acked: boolean;
  settings: OrchestratorSettings & { ai_question_response?: string | null };
  keep_facebook_open: boolean;
}

interface State {
  installed: boolean;
  latestSettings: CachedSettings | null;
  perTabDetectorInstalled: Set<number>;
  perThreadDebounce: Map<string, number>;
  lastLogAt: number;
}

const state: State = {
  installed: false,
  latestSettings: null,
  perTabDetectorInstalled: new Set(),
  perThreadDebounce: new Map(),
  lastLogAt: 0,
};

// ─────────────────────────────────────────────────────────────
// Settings cache
// ─────────────────────────────────────────────────────────────
async function loadSettingsFresh(): Promise<CachedSettings | null> {
  try {
    const resp = await getOverdriveSettings();
    const s = resp.settings || null;
    const cached: CachedSettings = {
      fetchedAt: Date.now(),
      master_enabled: !!s?.enabled,
      dealership_enabled: !!resp.dealership_enabled,
      linked: !!resp.linked?.facebook,
      disclosure_acked: !!resp.linked?.disclosure_ack_at,
      keep_facebook_open: !!s?.keep_facebook_open,
      settings: {
        active_hours_start: s?.active_hours_start ?? resp.defaults.active_hours_start,
        active_hours_end: s?.active_hours_end ?? resp.defaults.active_hours_end,
        timezone: s?.timezone ?? resp.defaults.timezone,
        cap_per_thread_per_minute: s?.cap_per_thread_per_minute ?? resp.defaults.cap_per_thread_per_minute,
        cap_per_thread_per_day: s?.cap_per_thread_per_day ?? resp.defaults.cap_per_thread_per_day,
        cap_per_rep_per_day: s?.cap_per_rep_per_day ?? resp.defaults.cap_per_rep_per_day,
        ai_question_response: s?.ai_question_response ?? null,
      },
    };
    await chrome.storage.local.set({ [SETTINGS_CACHE_KEY]: cached });
    state.latestSettings = cached;
    return cached;
  } catch (err) {
    // Fall back to whatever's cached locally.
    try {
      const stored = await chrome.storage.local.get([SETTINGS_CACHE_KEY]);
      const cached = stored?.[SETTINGS_CACHE_KEY] as CachedSettings | undefined;
      if (cached) {
        state.latestSettings = cached;
        return cached;
      }
    } catch { /* noop */ }
    return null;
  }
}

async function activeSettings(): Promise<CachedSettings | null> {
  if (state.latestSettings && Date.now() - state.latestSettings.fetchedAt < 5 * 60_000) {
    return state.latestSettings;
  }
  return loadSettingsFresh();
}

function overdriveGoLightIsGreen(cached: CachedSettings | null): boolean {
  if (!cached) return false;
  return cached.master_enabled && cached.dealership_enabled && cached.linked && cached.disclosure_acked;
}

// ─────────────────────────────────────────────────────────────
// Rep replies-today counter (aggregated across threads)
// ─────────────────────────────────────────────────────────────
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getRepRepliesTodayCount(): Promise<number> {
  try {
    const stored = await chrome.storage.local.get([REP_REPLIES_TODAY_KEY]);
    const val = stored?.[REP_REPLIES_TODAY_KEY] as { ymd: string; count: number } | undefined;
    if (!val || val.ymd !== todayYmd()) {
      await chrome.storage.local.set({ [REP_REPLIES_TODAY_KEY]: { ymd: todayYmd(), count: 0 } });
      return 0;
    }
    return val.count;
  } catch {
    return 0;
  }
}

async function bumpRepRepliesTodayCount(): Promise<void> {
  const current = await getRepRepliesTodayCount();
  await chrome.storage.local.set({ [REP_REPLIES_TODAY_KEY]: { ymd: todayYmd(), count: current + 1 } });
}

// ─────────────────────────────────────────────────────────────
// Structured logging — local ring buffer + best-effort API mirror
// ─────────────────────────────────────────────────────────────
const LOG_RING_KEY = 'overdrive_log_ring';
const LOG_RING_MAX = 200;

async function overdriveLog(entry: Record<string, unknown>): Promise<void> {
  const ts = Date.now();
  const enriched = { ts, ...entry };
  try {
    const stored = await chrome.storage.local.get([LOG_RING_KEY]);
    const ring = ((stored?.[LOG_RING_KEY] as unknown[]) || []).slice(-LOG_RING_MAX + 1);
    ring.push(enriched);
    await chrome.storage.local.set({ [LOG_RING_KEY]: ring });
  } catch { /* storage full */ }
  // Non-blocking: throttled console echo for live debugging (max 1/sec)
  if (ts - state.lastLogAt > 1000) {
    state.lastLogAt = ts;
    // eslint-disable-next-line no-console
    console.log('[overdrive]', enriched);
  }
}

// ─────────────────────────────────────────────────────────────
// Content-script bridge helpers
// ─────────────────────────────────────────────────────────────
async function sendToTab<T>(tabId: number, msg: unknown): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve((response as T) ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function findFacebookTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise<chrome.tabs.Tab[]>((resolve) => {
    try {
      chrome.tabs.query({ url: ['*://*.facebook.com/*', '*://*.messenger.com/*'] }, (tabs) => {
        resolve(tabs || []);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Ensure a facebook.com tab exists when keep_facebook_open is on.
 * Called on startup and on the keepalive alarm.
 */
async function ensureFacebookTabIfEnabled(cached: CachedSettings | null): Promise<void> {
  if (!cached?.keep_facebook_open) return;
  const tabs = await findFacebookTabs();
  if (tabs.length > 0) return;
  try {
    chrome.tabs.create({ url: 'https://www.facebook.com/messages/', pinned: true, active: false });
    await overdriveLog({ event: 'keepalive_opened_fb_tab' });
  } catch (err: any) {
    await overdriveLog({ event: 'keepalive_open_fb_tab_failed', error: err?.message });
  }
}

/**
 * Radar catch-up sweep — walk every open Facebook tab, ask the
 * content script for its visible chat-list snapshot, and fire
 * POST /api/v1/radar/capture for each item with sweep_source=
 * 'catchup_sweep'. Rate-limited to 1 capture/second per rep to look
 * human-plausible in the DOM read cadence. Server idempotency
 * prevents dupes across sweeps.
 */
async function runRadarCatchupSweep(): Promise<void> {
  await overdriveLog({ event: 'radar_sweep_start' });
  const tabs = await findFacebookTabs();
  if (tabs.length === 0) {
    await overdriveLog({ event: 'radar_sweep_no_tabs' });
    return;
  }
  const counts = { total: 0, created: 0, updated: 0, noop: 0, error: 0 };
  for (const tab of tabs) {
    if (!tab.id) continue;
    const list = await sendToTab<{ ok: boolean; items?: Array<{
      conversation_key: string;
      header_text: string;
      last_inbound_text: string;
      last_inbound_hash: string;
      url: string;
    }> }>(tab.id, { type: 'RADAR_SWEEP_LIST' });
    if (!list?.ok || !list.items) continue;
    for (const item of list.items) {
      try {
        counts.total += 1;
        // Split "<Buyer> · <Listing>" header if present.
        let customer_name: string | null = null;
        let listing_title: string | null = null;
        const parts = item.header_text.split(/\s*[·•]\s*/);
        if (parts.length >= 2) {
          customer_name = parts[0].trim() || null;
          listing_title = parts.slice(1).join(' · ').trim() || null;
        } else if (item.header_text) {
          customer_name = item.header_text;
        }
        const result = await radarCapture({
          conversation_key: item.conversation_key,
          last_inbound_hash: item.last_inbound_hash,
          last_inbound_text: item.last_inbound_text,
          customer_name,
          listing: { title: listing_title, url: item.url },
          source_platform: /marketplace/i.test(item.url) ? 'facebook_marketplace' : 'facebook_messenger',
          sweep_source: 'catchup_sweep',
        });
        if (result.mode === 'created') counts.created += 1;
        else if (result.mode === 'updated') counts.updated += 1;
        else if (result.mode === 'noop') counts.noop += 1;
        else if (!result.ok) counts.error += 1;
        // Human-plausible pacing: 1 capture / second per sweep.
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e: any) {
        counts.error += 1;
        await overdriveLog({ event: 'radar_sweep_item_error', error: e?.message });
      }
    }
  }
  await radarSweepDone(counts);
  await overdriveLog({ event: 'radar_sweep_done', counts });
}

/**
 * Install the detector on every Facebook tab, idempotent per tab.
 */
async function armDetectorOnAllFbTabs(): Promise<void> {
  const tabs = await findFacebookTabs();
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (state.perTabDetectorInstalled.has(tab.id)) continue;
    const ok = await sendToTab<{ ok: boolean }>(tab.id, { type: 'OVERDRIVE_INSTALL_DETECTOR' });
    if (ok?.ok) {
      state.perTabDetectorInstalled.add(tab.id);
      await overdriveLog({ event: 'detector_installed', tab_id: tab.id, url: tab.url });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Detection → orchestration pipeline
// ─────────────────────────────────────────────────────────────
async function handleDetectionSignal(tabId: number, signal: { type: string; conversation_hint?: string }): Promise<void> {
  const cached = await activeSettings();

  // Radar (migration 304) is decoupled from Overdrive: it runs whenever
  // the rep is signed in AND Facebook is linked, regardless of the
  // Overdrive toggle. Overdrive being green adds an autonomous reply
  // ON TOP of the radar capture. Neither gates the other.
  const radarEligible = !!(cached?.linked && cached?.disclosure_acked);
  const overdriveEligible = overdriveGoLightIsGreen(cached);

  if (!radarEligible && !overdriveEligible) {
    await overdriveLog({ event: 'skip_master_off', signal });
    return;
  }

  // Debounce: 3s per-tab minimum between orchestration cycles so a
  // burst of layer-1 + layer-2 + layer-3 signals from the same
  // inbound doesn't fire 3x.
  const debounceKey = `tab:${tabId}`;
  const lastFire = state.perThreadDebounce.get(debounceKey) || 0;
  if (Date.now() - lastFire < 3000) {
    await overdriveLog({ event: 'skip_debounce', tab_id: tabId, signal });
    return;
  }
  state.perThreadDebounce.set(debounceKey, Date.now());

  // Scrape the thread via content script.
  const scrape = await sendToTab<{ ok: boolean; scrape?: ThreadScrape }>(tabId, {
    type: 'OVERDRIVE_SCRAPE_THREAD',
  });
  if (!scrape?.ok || !scrape.scrape) {
    await overdriveLog({ event: 'scrape_failed', tab_id: tabId });
    return;
  }

  // ── Hop 1 receipts (migration 310) ──────────────────────────
  // Report every detection signal to the server BEFORE
  // qualification / caps / send. Gives Yancy a complete timeline
  // in event_log_v2 even when a thread is filtered out downstream.
  // Fire-and-forget; never block orchestration on this network hop.
  try {
    const sigType = String(signal?.type || 'unknown');
    const detectionSource =
      sigType === 'mutation' || sigType === 'mutation_observer' ? 'mutation_observer' :
      sigType === 'title' || sigType === 'title_watch' ? 'title_watch' :
      sigType === 'alarm' || sigType === 'alarm_sweep' ? 'alarm_sweep' :
      sigType === 'manual' ? 'manual' : sigType;
    reportOverdriveDetection({
      conversation_key: scrape.scrape.conversation_key,
      inbound_hash: scrape.scrape.last_inbound_hash || '',
      source: detectionSource,
    }).catch(() => { /* fire-and-forget */ });
  } catch { /* noop */ }

  // ── RADAR CAPTURE — always runs on scrape success ──────────
  // Fire the passive capture regardless of Overdrive eligibility so
  // every Marketplace inbound the rep's session sees becomes a lead.
  // Fail-silent — capture is best-effort, must not block Overdrive.
  if (radarEligible) {
    try {
      const s = scrape.scrape;
      // Header-derived candidates for customer_name / listing —
      // Facebook Marketplace threads use "<Buyer> · <Listing>" in the
      // h1. We split here for the server payload; the server also
      // runs isChannelOrUiName defensively.
      const headerText = String(s.header_text || '').trim();
      let customerName: string | null = null;
      let listingTitle: string | null = null;
      const parts = headerText.split(/\s*[·•]\s*/);
      if (parts.length >= 2) {
        customerName = parts[0].trim() || null;
        listingTitle = parts.slice(1).join(' · ').trim() || null;
      } else if (headerText) {
        customerName = headerText;
      }
      const radarResult = await radarCapture({
        conversation_key: s.conversation_key,
        last_inbound_hash: s.last_inbound_hash,
        last_inbound_text: s.last_inbound_text,
        customer_name: customerName,
        listing: {
          title: listingTitle,
          url: s.url,
        },
        source_platform: /marketplace/i.test(s.url || '') ? 'facebook_marketplace' : 'facebook_messenger',
        sweep_source: 'live',
      });
      await overdriveLog({ event: 'radar_capture', tab_id: tabId, result: radarResult });
    } catch (e: any) {
      await overdriveLog({ event: 'radar_capture_threw', tab_id: tabId, error: e?.message });
    }
  }

  // If Overdrive isn't green, we stop here — radar has already logged.
  if (!overdriveEligible) {
    return;
  }

  const deps: OrchestratorDeps = {
    injectText: async (text: string) => {
      const r = await sendToTab<{ ok: boolean }>(tabId, {
        type: 'OVERDRIVE_INJECT_TEXT',
        payload: { text },
      });
      return !!r?.ok;
    },
    clearInjectedText: async (text: string) => {
      const r = await sendToTab<{ ok: boolean }>(tabId, {
        type: 'OVERDRIVE_CLEAR_INJECTED_TEXT',
        payload: { text },
      });
      return !!r?.ok;
    },
    reacquireComposer: async () => {
      const r = await sendToTab<{ ok: boolean }>(tabId, {
        type: 'OVERDRIVE_REACQUIRE_COMPOSER',
      });
      return !!r?.ok;
    },
    emitEvent: (event) => {
      void overdriveLog({ event: 'orchestrator_emit', ...event });
      // Fire chrome.notifications on escalation with fallback to badge.
      if (event.type === 'overdrive.escalated') {
        fireEscalationNotification(event.conversation_key, event.payload as any);
      } else if (event.type === 'overdrive.replied' && isHeroStage(String((event.payload as any).stage || ''))) {
        // Nudge the badge to signal a hero event.
        try {
          chrome.action?.setBadgeBackgroundColor?.({ color: '#15803D' });
          chrome.action?.setBadgeText?.({ text: '★' });
          setTimeout(() => {
            chrome.action?.setBadgeText?.({ text: '' }).catch?.(() => {});
          }, 15000);
        } catch { /* noop */ }
      }
    },
    getRepRepliesTodayCount,
  };

  const result = await orchestrateReply(scrape.scrape, cached!.settings, deps);
  if (result.attempted && result.send?.verified) {
    await bumpRepRepliesTodayCount();
  }
  await overdriveLog({ event: 'orchestrator_result', ...result });
}

/**
 * chrome.notifications for escalation — fallback to setBadgeText if
 * the notifications permission wasn't granted.
 */
function fireEscalationNotification(conversationKey: string, payload: { reason?: string }): void {
  const notifId = `${NOTIFICATION_ID_PREFIX}${conversationKey.slice(0, 32)}`;
  try {
    if (chrome.notifications?.create) {
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: 'Overdrive handed off to you',
        message: `Reason: ${payload?.reason || 'flagged'}. Jump into the thread.`,
        priority: 2,
        requireInteraction: true,
      }, () => {
        // If permission missing, chrome.runtime.lastError is set; fallback.
        if (chrome.runtime.lastError) {
          fallbackBadgeAlert(payload?.reason);
        }
      });
      return;
    }
  } catch { /* noop */ }
  fallbackBadgeAlert(payload?.reason);
}

function fallbackBadgeAlert(reason?: string): void {
  try {
    chrome.action?.setBadgeBackgroundColor?.({ color: '#DC2626' });
    chrome.action?.setBadgeText?.({ text: '!' });
    setTimeout(() => {
      chrome.action?.setBadgeText?.({ text: '' }).catch?.(() => {});
    }, 30000);
    void overdriveLog({ event: 'fallback_badge_escalation', reason });
  } catch { /* noop */ }
}

// ─────────────────────────────────────────────────────────────
// Public API — install() called once from background.ts
// ─────────────────────────────────────────────────────────────
export async function installOverdriveController(): Promise<void> {
  if (state.installed) return;
  state.installed = true;

  // Kick off settings load and eager keepalive.
  void loadSettingsFresh();

  // 1.16.53: seed safetyEnvelope's solo-test-mode module state from
  // persisted storage on install so the flag survives service-worker
  // restarts. The sidepanel writes to the same storage key when the
  // rep toggles it.
  void loadSoloTestModeFromStorage().then((enabled) => {
    configureSoloTestMode(enabled);
    void broadcastSoloTestModeToTabs(enabled);
  });

  // 1.16.53: replay any pending send-confirms that survived a worker
  // teardown. Runs on install/startup and on every keepalive alarm.
  void replayPendingConfirms();

  // chrome.runtime.onStartup — open FB tab if keep_facebook_open.
  try {
    chrome.runtime.onStartup?.addListener(() => {
      void loadSettingsFresh().then((cached) => ensureFacebookTabIfEnabled(cached));
    });
  } catch { /* noop */ }

  // 1.16.47 W2-A3: OVERDRIVE_STATE_CHANGED subscription via poll.
  // Cheap /api/overdrive/state returns max(server_ts) of any overdrive
  // toggle/pause/resume/takeover for this rep+dealership. When it
  // changes we refresh settings and broadcast to the sidepanel so
  // per-thread controls repaint. Poll every 8s while the SW is alive;
  // the sidepanel does its own poll while it's open, so this is the
  // background layer that keeps the go-light in sync while the panel
  // is closed.
  const STATE_POLL_ALARM = 'brevmont_overdrive_state_poll';
  try {
    chrome.alarms.create(STATE_POLL_ALARM, { periodInMinutes: 0.15 }); // ~9s
  } catch { /* noop */ }
  let lastSeenStateSeq: string | null = null;
  const pollOverdriveState = async (): Promise<void> => {
    try {
      const { getOverdriveStateSeq } = await import('./apiClient');
      const { seq } = await getOverdriveStateSeq();
      if (!seq || seq === lastSeenStateSeq) return;
      lastSeenStateSeq = seq;
      const cached = await loadSettingsFresh();
      // Belt-and-suspenders arm the detector — cached may now be
      // green when it wasn't before (rep flipped their toggle ON from
      // the web app).
      if (overdriveGoLightIsGreen(cached)) {
        await armDetectorOnAllFbTabs();
      }
      // Notify sidepanel + any open surface. Sidepanel per-thread UI
      // re-fetches its own thread state on this signal.
      try {
        chrome.runtime.sendMessage({
          type: 'OVERDRIVE_STATE_CHANGED',
          seq,
          at: Date.now(),
        }).catch(() => {});
      } catch { /* noop */ }
    } catch { /* noop — polls silently */ }
  };

  // Register the keepalive alarm (1 min).
  try {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
    // Radar catch-up sweep — every 30min while radar is eligible.
    // Walks the Marketplace chat list and captures anything the
    // observer missed while Chrome was closed. Rate-limited server-side
    // by the idempotency index (migration 304).
    chrome.alarms.create(RADAR_SWEEP_ALARM, { periodInMinutes: 30, delayInMinutes: 2 });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === STATE_POLL_ALARM) {
        await pollOverdriveState();
        return;
      }
      if (alarm.name === KEEPALIVE_ALARM) {
        const cached = await activeSettings();
        await ensureFacebookTabIfEnabled(cached);
        // Install detector when EITHER radar or overdrive is eligible;
        // radar-only paths still need the observer to fire signals.
        const radarEligible = !!(cached?.linked && cached?.disclosure_acked);
        if (overdriveGoLightIsGreen(cached) || radarEligible) {
          await armDetectorOnAllFbTabs();
        }
        // Replay any pending send-confirms that survived a worker
        // teardown mid-fetch. Server dedupes by idempotency_key.
        void replayPendingConfirms();
        return;
      }
      if (alarm.name === RADAR_SWEEP_ALARM) {
        const cached = await activeSettings();
        const radarEligible = !!(cached?.linked && cached?.disclosure_acked);
        if (!radarEligible) return;
        await runRadarCatchupSweep();
        return;
      }
    });
  } catch { /* noop */ }

  // Tab lifecycle — arm detector when a FB tab becomes ready.
  try {
    chrome.tabs.onUpdated?.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete') return;
      if (!tab?.url) return;
      try {
        const host = new URL(tab.url).host;
        if (!FACEBOOK_HOSTS.test(host)) return;
      } catch { return; }
      const cached = await activeSettings();
      // Radar-only paths still need the observer installed. Install
      // when EITHER radar or overdrive is eligible.
      const radarEligible = !!(cached?.linked && cached?.disclosure_acked);
      if (!overdriveGoLightIsGreen(cached) && !radarEligible) return;
      const r = await sendToTab<{ ok: boolean }>(tabId, { type: 'OVERDRIVE_INSTALL_DETECTOR' });
      if (r?.ok) state.perTabDetectorInstalled.add(tabId);
    });
    chrome.tabs.onRemoved?.addListener((tabId) => {
      state.perTabDetectorInstalled.delete(tabId);
    });
  } catch { /* noop */ }

  // Detection signals from content script + settings refresh from sidepanel.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;
      const m = msg as { type: string; signal?: { type: string; conversation_hint?: string } };

      if (m.type === 'OVERDRIVE_DETECTION_SIGNAL') {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false }); return false; }
        void handleDetectionSignal(tabId, m.signal || { type: 'unknown' });
        sendResponse({ ok: true });
        return false;
      }

      if (m.type === 'OVERDRIVE_SOLO_TEST_MODE_CHANGED') {
        // Sidepanel toggle — persist, reconfigure safetyEnvelope in the
        // background worker, and broadcast to all Facebook tabs so
        // their content-script safetyEnvelope module state matches.
        const enabled = !!(m as any).enabled;
        (async () => {
          try {
            await chrome.storage.local.set({ [SOLO_TEST_MODE_KEY]: enabled });
          } catch { /* noop */ }
          configureSoloTestMode(enabled);
          await broadcastSoloTestModeToTabs(enabled);
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (m.type === 'OVERDRIVE_REFRESH_SETTINGS') {
        // Sidepanel calls this after any toggle change so the
        // controller re-reads settings on the next cycle without
        // waiting for the 5-min TTL.
        void loadSettingsFresh().then(async (cached) => {
          if (overdriveGoLightIsGreen(cached)) {
            await armDetectorOnAllFbTabs();
          }
        });
        sendResponse({ ok: true });
        return false;
      }

      if (m.type === 'OVERDRIVE_CONTROLLER_STATUS') {
        sendResponse(overdriveControllerStatus());
        return false;
      }

      if (m.type === 'OVERDRIVE_READ_LOG') {
        chrome.storage.local.get([LOG_RING_KEY], (data) => {
          sendResponse({ ok: true, log: data?.[LOG_RING_KEY] || [] });
        });
        return true;
      }

      return false;
    });
  } catch { /* noop */ }

  // Kick off an initial arm on all existing FB tabs.
  const cached = await activeSettings();
  if (overdriveGoLightIsGreen(cached)) {
    await armDetectorOnAllFbTabs();
  }
  await overdriveLog({ event: 'controller_installed', go: overdriveGoLightIsGreen(cached) });
}

/**
 * Force a settings refresh (called by the sidepanel after toggle changes).
 */
export async function refreshOverdriveSettings(): Promise<CachedSettings | null> {
  return loadSettingsFresh();
}

/**
 * Read-only accessor for the sidepanel / debug console.
 */
export function overdriveControllerStatus(): {
  installed: boolean;
  cache_age_ms: number | null;
  master_enabled: boolean;
  dealership_enabled: boolean;
  linked: boolean;
  disclosure_acked: boolean;
  detector_tabs: number[];
} {
  return {
    installed: state.installed,
    cache_age_ms: state.latestSettings ? Date.now() - state.latestSettings.fetchedAt : null,
    master_enabled: !!state.latestSettings?.master_enabled,
    dealership_enabled: !!state.latestSettings?.dealership_enabled,
    linked: !!state.latestSettings?.linked,
    disclosure_acked: !!state.latestSettings?.disclosure_acked,
    detector_tabs: [...state.perTabDetectorInstalled],
  };
}
