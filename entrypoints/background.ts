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
const GENERATION_POLL_TIMEOUT_MS = 60_000;
const BLANK_CONTEXT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function updateFreeTierBadge(usage?: { remaining?: number; generations_remaining?: number }, tier?: string) {
  try {
    const local = await browser.storage.local.get(['brevmont_tier', 'brevmont_usage']);
    const resolvedTier = String(tier || local.brevmont_tier || '').toLowerCase();
    const isFree = resolvedTier === 'free' || resolvedTier === 'free_trial';
    if (!isFree) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const localUsage = local.brevmont_usage || {};
    const remaining = Number(
      usage?.remaining ??
      usage?.generations_remaining ??
      localUsage.generations_remaining ??
      Math.max(0, Number(localUsage.generations_limit || 500) - Number(localUsage.generations_used || 0))
    );
    await chrome.action.setBadgeBackgroundColor({ color: '#0D6E6E' });
    await chrome.action.setBadgeText({ text: Number.isFinite(remaining) ? String(Math.max(0, remaining)) : '' });
  } catch {
    // Badge updates should never block auth or generation.
  }
}

async function claimReferralAfterFirstGeneration() {
  try {
    const local = await browser.storage.local.get([REFERRAL_CODE_KEY, REFERRAL_CLAIMED_KEY]);
    if (!local[REFERRAL_CODE_KEY] || local[REFERRAL_CLAIMED_KEY]) return;
    const base = (await getResolvedApiUrl()).replace(/\/$/, '');
    const resp = await signedFetch(`${base}/api/v1/referrals/first-generation`, {
      referral_code: String(local[REFERRAL_CODE_KEY]),
    });
    if (resp.ok) await browser.storage.local.set({ [REFERRAL_CLAIMED_KEY]: true });
  } catch {
    // Best-effort. The next successful generation can retry.
  }
}

/**
 * Retry wrapper with linear backoff for transient network failures.
 * Returns the Response on success (<500) or throws after exhausting attempts.
 */
async function fetchWithRetry(url: string, opts: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || res.status < 500) return res;
    } catch (e) {
      if (i === attempts - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('fetch failed after retries');
}

import { signedFetch, signedPatch, signedGet } from '../lib/authSigning';
import { enqueue, processQueue, getQueueCount as getDexieQueueCount } from '../lib/retryQueue';
import { telemetry } from './lib/telemetry';
import { dlog } from './lib/dev';
import { initSentry, setSentryContext, captureError, addBreadcrumb } from '../lib/sentry';
import { fetchRemoteConfig, getResolvedApiUrl, applyConfig } from '../lib/remoteConfig';
import { hasCompleteActivation } from './lib/activationState';
import * as storage from '../lib/storage';
import {
  BREVMONT_UNINSTALL_URL,
  BREVMONT_WELCOME_URL,
  REFERRAL_CLAIMED_KEY,
  REFERRAL_CODE_KEY,
} from './lib/cwsDistribution';

try {
  const uninstallResult = chrome.runtime.setUninstallURL?.(BREVMONT_UNINSTALL_URL);
  if (uninstallResult && typeof (uninstallResult as Promise<void>).catch === 'function') {
    void (uninstallResult as Promise<void>).catch(() => {});
  }
} catch {
  // Missing browser API in tests should not block startup.
}

void storage.init();
import { leadDb } from '../lib/leadDb';
import { syncPendingLeads, getSyncStats } from '../lib/leadSync';
import type { LocalLead } from '../lib/types/lead';
import { getLegacyFeatureFlagsForTier } from '../lib/featureGate';

function parseLooseLeadText(rawText: unknown): { customer_name?: string | null; vehicle_interest?: string | null } {
  const raw = String(rawText || '').trim();
  if (!raw) return {};
  const spacedVehicle = raw.match(/\b((?:19|20)\d{2}\s+[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\b/i);
  const gluedVehicle = raw.match(/\b((?:19|20)\d{2})([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z0-9-]*){0,3})\b/i);
  const yearLastVehicle = raw.match(/\b((?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian)\s+[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,3})\s+((?:19|20)\d{2})\b/i);
  const vehicle = spacedVehicle?.[1]?.trim()
    || (gluedVehicle ? `${gluedVehicle[1]} ${gluedVehicle[2]}`.trim() : null)
    || (yearLastVehicle ? `${yearLastVehicle[2]} ${yearLastVehicle[1]}`.trim() : null);
  const vehicleNeedle = spacedVehicle?.[0] || gluedVehicle?.[0] || yearLastVehicle?.[0] || vehicle || '';
  const profileName = raw.match(/\bProfile name:\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/i)?.[1]?.trim() || null;
  const beforeVehicle = vehicleNeedle ? raw.slice(0, raw.indexOf(vehicleNeedle)) : raw.split(/[,;\n|]/)[0];
  const name = (profileName || beforeVehicle
    .replace(/\b(name|customer|lead|sender)\s*:/gi, ' ')
    .replace(/[0-9]/g, ' ')
    .replace(/[^A-Za-z' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    customer_name: parts.length >= 1 && parts.length <= 4 && !isBadLeadName(parts.join(' ')) ? parts.join(' ') : null,
    vehicle_interest: vehicle,
  };
}

function isBadLeadName(value: unknown): boolean {
  const raw = String(value || '').trim();
  return !raw || /^(?:messenger|facebook|marketplace|chats|save lead|scan|unknown)$/i.test(raw);
}

function inferLocalLeadHeat(lead: any, payload: any): number {
  const existing = Number(lead?.heat_score ?? lead?.heat);
  if (Number.isFinite(existing) && existing > 0) return Math.min(100, Math.max(0, Math.round(existing)));

  const confidence = String(lead?.confidence || '').toLowerCase();
  const intent = String(lead?.intent || '').toLowerCase();
  let score = confidence === 'high' ? 80 : confidence === 'medium' ? 65 : 45;
  if (lead?.phone || payload?.phone) score += 8;
  if (lead?.email || payload?.email) score += 5;
  if (lead?.vehicle_interest || lead?.vehicle || payload?.vehicle_interest || payload?.vehicle) score += 10;
  if (['trade_in', 'financing', 'individual_buyer', 'fleet_inquiry'].includes(intent)) score += 8;
  return Math.min(95, Math.max(25, Math.round(score)));
}

function hasVehicleOrBuyingSignal(rawText: unknown): boolean {
  const raw = String(rawText || '');
  return /\b(?:19|20)\d{2}\s*(?:Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian|Tacoma|Silverado|Tahoe|Suburban|F-?150|Camry|Corolla|Accord|Civic|Telluride|Sorento|Sportage)\b/i.test(raw)
    || /\b(?:buy|purchase|quote|price|pricing|payment|finance|lease|trade(?:-?in)?|test drive|appointment|interested|availability|in stock|inventory|fleet|company car|work truck|vehicle inquiry|looking for|need|want)\b/i.test(raw);
}

function looksLikeSystemSender(rawText: unknown): boolean {
  const raw = String(rawText || '').toLowerCase();
  return /(?:brevmont\.com|onboarding@|no-?reply|donotreply|mailer-daemon|mailchimp|sendgrid|twilio|stripe|google calendar|calendly|resend|postmark|mailgun)/i.test(raw);
}

function shouldPersistPartialLead(payload: any): boolean {
  const rawText = payload?.raw_text || '';
  const platform = String(payload?.platform || '').toLowerCase();
  const looseFallback = parseLooseLeadText(rawText);
  const hasPartial = Boolean(
    payload?.customer_name ||
    payload?.customerName ||
    payload?.name ||
    payload?.phone ||
    payload?.email ||
    payload?.vehicle_interest ||
    payload?.vehicle ||
    looseFallback.customer_name ||
    looseFallback.vehicle_interest
  );
  if (!hasPartial) return false;
  if (looksLikeSystemSender(rawText) && !hasVehicleOrBuyingSignal(rawText)) return false;
  if (payload?.phone || payload?.email || payload?.vehicle_interest || payload?.vehicle || looseFallback.vehicle_interest) return true;
  return /^(facebook|messenger|linkedin|instagram|unknown)$/.test(platform);
}

function cleanLeadMetaValue(value: unknown): string | null {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && text.toLowerCase() !== 'unknown' ? text : null;
}

function toolLeadMetadata(payload: any, platformFallback: unknown = 'unknown'): Record<string, any> {
  const leadContext = payload?.leadContext && typeof payload.leadContext === 'object' ? payload.leadContext : {};
  const vehicle = cleanLeadMetaValue(
    leadContext.vehicle ||
    leadContext.vehicleOfInterest ||
    leadContext.vehicle_interest ||
    payload?.vehicleContext ||
    payload?.vehicle
  );
  const customerName = cleanLeadMetaValue(
    leadContext.customerName ||
    leadContext.customer_name ||
    leadContext.name ||
    payload?.customer_name ||
    payload?.customerName ||
    payload?.name
  );
  const rawPlatform = cleanLeadMetaValue(leadContext.platform || payload?.platform || platformFallback) || 'unknown';
  const platform = rawPlatform === 'facebook' ? 'messenger' : rawPlatform;
  return {
    customer_id: cleanLeadMetaValue(leadContext.customer_id || payload?.customer_id || payload?.customerId),
    detection_method: cleanLeadMetaValue(leadContext.detectionMethod || leadContext.detection_method || payload?.detection_method),
    detection_confidence: leadContext.detectionConfidence ?? leadContext.detection_confidence ?? payload?.detection_confidence ?? null,
    customer_name: customerName,
    customer_phone: cleanLeadMetaValue(leadContext.phone || leadContext.customer_phone || payload?.phone),
    customer_email: cleanLeadMetaValue(leadContext.email || leadContext.customer_email || payload?.email),
    vehicle,
    vehicle_interest: vehicle,
    vehicle_of_interest: vehicle,
    source_platform: platform,
    platform,
    lead_source: cleanLeadMetaValue(leadContext.source || payload?.source),
    captured_lead_id: cleanLeadMetaValue(leadContext.captured_lead_id || leadContext.lead_id || leadContext.id || payload?.captured_lead_id || payload?.lead_id),
    lead_id: cleanLeadMetaValue(leadContext.captured_lead_id || leadContext.lead_id || leadContext.id || payload?.captured_lead_id || payload?.lead_id),
  };
}

function objectionCategoryFromText(value: unknown): string | null {
  const raw = String(value || '').toLowerCase();
  if (!raw.trim()) return null;
  if (/price|too high|expensive|cheaper/.test(raw)) return 'PRICE_TOO_HIGH';
  if (/payment|monthly|rate|apr/.test(raw)) return 'PAYMENT_SHOCK';
  if (/spouse|wife|husband|partner/.test(raw)) return 'SPOUSE_NOT_HERE';
  if (/trade/.test(raw)) return 'TRADE_VALUE';
  if (/credit|score|approval/.test(raw)) return 'CREDIT';
  if (/just looking/.test(raw)) return 'JUST_LOOKING';
  if (/think|sleep on|not sure/.test(raw)) return 'NEED_TO_THINK';
  return null;
}

async function logToolEvent(
  eventType: 'ask_anything' | 'coach_me' | 'reminder_set' | 'screenshot_reply',
  input: string,
  output: string,
  metadata: Record<string, any> = {},
): Promise<void> {
  try {
    const apiBase = await getResolvedApiUrl();
    await signedFetch(`${apiBase}/api/v1/tool-event`, {
      event_type: eventType,
      input,
      output,
      metadata,
    });
  } catch (err) {
    console.warn('[Brevmont] tool event log failed:', (err as Error)?.message || err);
  }
}

function customerQuery(params: Record<string, any>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim()) qs.set(key, String(value).trim());
  }
  return qs.toString();
}

async function customerMatch(payload: any): Promise<any> {
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const qs = customerQuery({
    name: payload?.name || payload?.customer_name || payload?.customerName,
    phone: payload?.phone || payload?.customer_phone,
    email: payload?.email || payload?.customer_email,
    customer_id: payload?.customer_id,
  });
  const resp = await signedGet(`${base}/api/v1/customers/match${qs ? `?${qs}` : ''}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `customer_match_${resp.status}`);
  return data;
}

async function customerList(payload: any): Promise<any> {
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const qs = customerQuery({ search: payload?.search, limit: payload?.limit || 5 });
  const resp = await signedGet(`${base}/api/v1/customers${qs ? `?${qs}` : ''}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `customer_list_${resp.status}`);
  return data;
}

async function customerCreate(payload: any): Promise<any> {
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const resp = await signedFetch(`${base}/api/v1/customers`, {
    name: payload?.name || payload?.customer_name || payload?.customerName,
    phone: payload?.phone || payload?.customer_phone || null,
    email: payload?.email || payload?.customer_email || null,
    vehicle_interest: payload?.vehicle_interest || payload?.vehicle || null,
    source: payload?.source || payload?.platform || null,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `customer_create_${resp.status}`);
  return data;
}

async function customerStamp(payload: any): Promise<any> {
  const customerId = String(payload?.customer_id || '');
  if (!customerId) throw new Error('customer_id_required');
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const resp = await signedFetch(`${base}/api/v1/customers/${encodeURIComponent(customerId)}/stamp`, payload);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `customer_stamp_${resp.status}`);
  return data;
}

async function resolveCustomerForContext(payload: any): Promise<any | null> {
  const name = cleanLeadMetaValue(payload?.name || payload?.customer_name || payload?.customerName);
  if (!name) return null;
  try {
    const match = await customerMatch(payload);
    if (match?.match && Number(match.confidence || 0) >= 0.7) return match.match;
  } catch {
    // fall through to create
  }
  try {
    return await customerCreate({ ...payload, name });
  } catch (err) {
    console.warn('[Brevmont] customer resolve failed:', (err as Error)?.message || err);
    return null;
  }
}

initSentry();

export default defineBackground(() => {
  // ── Permission-gated Side Panel ──
  // First click opens the mic permission page if setup hasn't completed.
  // After setup_complete flag is set, clicks open the side panel directly.
  const SETUP_KEY = 'brevmont_setup_complete';

  function configureSidePanelAction(): void {
    try {
      const sidePanel = chrome.sidePanel as any;
      if (sidePanel?.setPanelBehavior) {
        sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: any) => {
          console.warn('[Brevmont] sidePanel.setPanelBehavior failed:', err?.message || err);
        });
      }
    } catch (err: any) {
      console.warn('[Brevmont] side panel behavior unavailable:', err?.message || err);
    }
  }

  async function openSidePanelForActionClick(tab?: chrome.tabs.Tab): Promise<boolean> {
    try {
      const sidePanel = chrome.sidePanel as any;
      if (!sidePanel?.open) return false;
      if (typeof tab?.windowId === 'number') {
        await sidePanel.open({ windowId: tab.windowId });
        return true;
      }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (typeof activeTab?.windowId === 'number') {
        await sidePanel.open({ windowId: activeTab.windowId });
        return true;
      }
    } catch (err: any) {
      console.warn('[Brevmont] sidePanel.open failed:', err?.message || err);
    }
    return false;
  }

  configureSidePanelAction();
  chrome.runtime.onStartup?.addListener(configureSidePanelAction);
  chrome.runtime.onInstalled?.addListener(configureSidePanelAction);

  chrome.action.onClicked.addListener(async (tab) => {
    try {
      const opened = await openSidePanelForActionClick(tab);
      if (opened) return;

      const data = await chrome.storage.local.get([SETUP_KEY, 'profile_onboarded', 'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']);
      if (data[SETUP_KEY] && data.profile_onboarded) {
        // Setup done — open side panel directly
        await (chrome.sidePanel as any).open({ windowId: tab.windowId });
      } else if (data.dealer_token || data.rep_auth_token || data.brevmont_rep_auth_token) {
        await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
      } else {
        // First time — open permission page as a full tab
        await chrome.tabs.create({ url: 'https://app.brevmont.com/auth/extension' });
      }
    } catch (e) {
      console.warn('[Brevmont] action.onClicked handler error:', e);
      // Fallback: try opening permission page
      chrome.tabs.create({ url: 'https://app.brevmont.com/auth/extension' }).catch(() => {});
    }
  });

  // Telegram-via-API ping on install/update so the founder gets a
  // confirmation message every time Chrome loads or reloads the extension.
  // No more guessing which version is actually running.
  try {
    chrome.runtime.onInstalled.addListener((details) => {
      try {
        const version = chrome.runtime.getManifest()?.version || 'unknown';
        fetch(`${PROXY_URL}/api/v1/extension-loaded`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version,
            reason: details.reason,
            ts: new Date().toISOString(),
          }),
        }).catch(() => {});
        // Also fire the lighter health-ping handshake so the API records
        // the running version on every install/update without paging
        // Telegram a second time. The response carries `latest_known_version`
        // and a `stale` flag that surface in the panel's version badge.
        fetch(`${PROXY_URL}/v1/health/extension-ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Extension-Version': version },
          body: JSON.stringify({ version, ts: new Date().toISOString() }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && typeof data === 'object' && 'stale' in data) {
              browser.storage.local.set({
                brevmont_ext_version_stale: !!(data as { stale?: boolean }).stale,
                brevmont_ext_latest_known: (data as { latest_known_version?: string }).latest_known_version || null,
              }).catch(() => {});
            }
          })
          .catch(() => {});
      } catch {}
    });
  } catch {}

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

  // app.brevmont.com /install detection — RepLanding pings via externally_connectable
  chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    if ((message as { type?: string })?.type === 'PING') {
      sendResponse({ ok: true, pong: true, version: chrome.runtime.getManifest().version });
      return false;
    }
    if ((message as { type?: string })?.type === 'WEBAPP_INSTALL_CHECK') {
      try {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      } catch {
        /* noop */
      }
      return false;
    }
    if ((message as { type?: string })?.type === 'BREVMONT_REP_SESSION_READY') {
      try {
        void tryCookieShareAutoConfig()
          .then((configured) => {
            if (configured) sendHeartbeat().catch(() => {});
            sendResponse({ ok: configured, version: chrome.runtime.getManifest().version });
          })
          .catch(() => sendResponse({ ok: false, version: chrome.runtime.getManifest().version }));
        return true;
      } catch {
        sendResponse({ ok: false });
        return false;
      }
    }
    if ((message as { type?: string; referral_code?: string })?.type === 'BREVMONT_REFERRAL_CODE') {
      const referralCode = String((message as any).referral_code || '').trim();
      if (referralCode) {
        void browser.storage.local.set({ [REFERRAL_CODE_KEY]: referralCode });
        sendResponse({ ok: true });
        return false;
      }
    }
    return false;
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CUSTOMER_CONTEXT') {
      void browser.storage.session.set({
        brevmont_customer_context: {
          ...(msg.payload || {}),
          updatedAt: Date.now(),
        },
      }).catch(() => {});
      return false;
    }

    // Health check — content script pings to verify service worker is alive
    if (msg.type === 'PING') { sendResponse({ pong: true }); return false; }

    if (msg.type === 'SYNC_AUTH_FROM_COOKIE') {
      (async () => {
        try {
          const configured = await tryCookieShareAutoConfig();
          if (configured) sendHeartbeat().catch(() => {});
          const local = await browser.storage.local.get([
            'dealer_token',
            'rep_auth_token',
            'brevmont_rep_auth_token',
            'rep_name',
            'dealership',
            'brevmont_tier',
            'dealership_tier',
            'dealership_plan',
          ]);
          sendResponse({ ok: true, configured, auth: local });
        } catch (err: any) {
          sendResponse({ ok: false, configured: false, error: err?.message || 'auth_sync_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'OPEN_BREVMONT_SIDE_PANEL') {
      (async () => {
        try {
          const windowId =
            typeof msg.windowId === 'number'
              ? msg.windowId
              : typeof sender.tab?.windowId === 'number'
                ? sender.tab.windowId
                : null;

          if (typeof windowId !== 'number') {
            sendResponse({ ok: false, error: 'missing_window' });
            return;
          }

          await (chrome.sidePanel as any).open({ windowId });
          sendResponse({ ok: true });
        } catch (e: any) {
          sendResponse({ ok: false, error: e?.message || 'side_panel_open_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_SYNC_QUEUE_COUNT') {
      getDexieQueueCount().then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
      return true;
    }

    if (msg.type === 'SUPPORT_REPORT') {
      (async () => {
        try {
          const sync = await browser.storage.local.get(['dealer_token', 'rep_name']);
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
          void processQueue(apiUrl).catch(() => {});
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
          sendResponse({ error: 'Generation failed. Try again or contact support@brevmont.com' });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_GENERATION_STATUS') {
      (async () => {
        try {
          const status = await handleGenerationStatus();
          sendResponse({ ok: true, ...status });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'status_unavailable' });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_REFERRAL_LINK') {
      (async () => {
        try {
          const base = (await getResolvedApiUrl()).replace(/\/$/, '');
          const resp = await signedFetch(`${base}/api/v1/referrals/link`, {});
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data?.error || 'referral_unavailable');
          sendResponse({ ok: true, referral_code: data.referral_code, referral_url: data.referral_url });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'referral_unavailable' });
        }
      })();
      return true;
    }

    if (msg.type === 'INVITE_GM') {
      (async () => {
        try {
          const result = await handleInviteGm(msg.payload || {});
          sendResponse({ ok: true, ...result });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'invite_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'CUSTOMER_MATCH') {
      (async () => {
        try {
          const result = await customerMatch(msg.payload || {});
          sendResponse({ ok: true, ...result });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'customer_match_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'CUSTOMER_LIST') {
      (async () => {
        try {
          const result = await customerList(msg.payload || {});
          sendResponse({ ok: true, ...result });
        } catch (err: any) {
          sendResponse({ ok: false, customers: [], error: err?.message || 'customer_list_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'CUSTOMER_CREATE') {
      (async () => {
        try {
          const result = await customerCreate(msg.payload || {});
          sendResponse({ ok: true, customer: result, ...result });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'customer_create_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'CUSTOMER_STAMP') {
      (async () => {
        try {
          const result = await customerStamp(msg.payload || {});
          sendResponse({ ok: true, ...result });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'customer_stamp_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'CHECK_FEATURES') {
      browser.storage.local.get(['brevmont_tier', 'brevmont_features', 'brevmont_last_heartbeat']).then(data => {
        const stale = !data.brevmont_last_heartbeat || (Date.now() - data.brevmont_last_heartbeat > 30 * 60 * 1000);
        const tier = stale ? (data.brevmont_tier || 'free') : (data.brevmont_tier || 'free');
        sendResponse({ tier, features: getTierFeatures(tier) });
      }).catch(() => sendResponse({ tier: 'free', features: getTierFeatures('free') }));
      return true;
    }

    // GET_RESOLVED_ACCESS — sidepanel calls this to populate the account chip
    // (rep name, dealership, tier badge). Backed by /api/v1/access/resolved
    // which merges dealership defaults + per-rep overrides.
    if (msg.type === 'GET_RESOLVED_ACCESS') {
      (async () => {
        try {
          const apiBase = await getResolvedApiUrl();
          const [resp, settings] = await Promise.all([
            signedGet(`${apiBase}/api/v1/access/resolved`),
            browser.storage.sync.get(['rep_name', 'dealership']),
          ]);
          if (!resp.ok) {
            sendResponse({ ok: false, status: resp.status });
            return;
          }
          const access = await resp.json();
          sendResponse({
            ok: true,
            access,
            rep_name: settings.rep_name || '',
            dealership: settings.dealership || '',
          });
        } catch (err: any) {
          sendResponse({ ok: false, error: err?.message || 'fetch_failed' });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_SETTINGS') {
      browser.storage.local.get(['rep_name', 'dealership', 'dealer_token'])
        .then(sendResponse);
      return true;
    }

    // Note: LOG_ACTION and LOG_COPY are legacy fire-and-forget handlers.
    // No callers exist in the extension as of v1.16.4 (verified 2026-05-09).
    // sendResponse is intentionally not called. return false = synchronous.
    if (msg.type === 'LOG_ACTION') {
      const p = msg.payload;
      browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token', 'rep_id', 'dealer_token']).then(async (local) => {
        let repToken = (local.rep_auth_token as string) || (local.brevmont_rep_auth_token as string) || '';
        if (!repToken) {
          const sync = await browser.storage.local.get(['rep_auth_token', 'dealer_token']);
          repToken = (sync.rep_auth_token as string) || '';
          // Fallback: use dealer_token if rep_auth_token unavailable (server accepts both via requireExtensionAuth)
          if (!repToken) repToken = (local.dealer_token as string) || (sync.dealer_token as string) || '';
        }
        if (!repToken) return;
        const ACTION_MAP: Record<string, string> = {
          GENERATE: 'crm.generation', PASTE: 'crm.paste',
          SEND: 'crm.send', CONFIRM: 'crm.confirm',
        };
        const event_type = ACTION_MAP[(p.action_type || '').toUpperCase()] || 'crm.generation';
        try {
          await fetch(`${PROXY_URL}/api/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${repToken}` },
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
      browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token', 'rep_id', 'dealer_token']).then(async (local) => {
        let repToken = (local.rep_auth_token as string) || (local.brevmont_rep_auth_token as string) || '';
        if (!repToken) {
          const sync = await browser.storage.local.get(['rep_auth_token', 'dealer_token']);
          repToken = (sync.rep_auth_token as string) || '';
          if (!repToken) repToken = (local.dealer_token as string) || (sync.dealer_token as string) || '';
        }
        if (!repToken) return;
        const label = (p.label || 'COPY').toUpperCase();
        const LABEL_MAP: Record<string, string> = {
          LEAD_CAPTURED: 'crm.generation', EMAIL_QUEUED: 'crm.send',
          EMAIL_APPLIED: 'crm.paste', CRM_NOTE_QUEUED: 'crm.paste',
        };
        const event_type = LABEL_MAP[label] || 'crm.paste';
        try {
          await fetch(`${PROXY_URL}/api/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${repToken}` },
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
      void hasCompleteActivation().then((ok) => {
        if (ok) return;
        browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') }).catch(() => {});
      });
      return false;
    }

    if (msg.type === 'OPEN_EXTENSION_SETTINGS') {
      // Open the extension's Chrome site-settings page so the user can
      // manually flip Microphone to "Allow" on managed browsers.
      const settingsUrl = msg.url || `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`;
      chrome.tabs.create({ url: settingsUrl }).then(() => {
        sendResponse?.({ ok: true });
      }).catch(() => {
        sendResponse?.({ ok: false });
      });
      return true; // keep message channel open for async sendResponse
    }

    if (msg.type === 'OPEN_MIC_PERMISSION') {
      browser.windows.create({
        url: browser.runtime.getURL('permission.html'),
        type: 'popup', width: 420, height: 340, focused: true,
      }).catch(() => {
        browser.tabs.create({ url: browser.runtime.getURL('permission.html') }).catch(() => {});
      });
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
          await requireFeature('lead_capture', 'Deal outcomes');
          const settings = await browser.storage.local.get(['dealer_token', 'rep_name', 'dealership']);
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
      (async () => {
        try {
          await requireFeature('voice_coach', 'Coach Me');
          addBreadcrumb('coaching', 'User requested coaching', { situation: msg.payload?.situation });
          const result = await handleCoach(msg.payload);
          addBreadcrumb('coaching', 'Coaching response received');
          sendResponse(result);
        } catch (err: any) {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('429') ? 'API_ERROR' : 'UNKNOWN';
          captureError(err instanceof Error ? err : new Error(String(err?.message || err)), { flow: 'COACH_ME', errType });
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message || 'Coach unavailable. Try again.' });
        }
      })();
      return true;
    }

    if (msg.type === 'EXECUTE_COMMAND') {
      (async () => {
        try {
          await requireFeature('command_mode', 'Ask Anything');
          addBreadcrumb('command', 'User requested command', { command: msg.payload?.command });
          const result = await handleCommand(msg.payload);
          addBreadcrumb('command', 'Command response received');
          sendResponse(result);
        } catch (err: any) {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('429') ? 'API_ERROR' : 'UNKNOWN';
          captureError(err instanceof Error ? err : new Error(String(err?.message || err)), { flow: 'EXECUTE_COMMAND', errType });
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message || 'Command unavailable. Try again.' });
        }
      })();
      return true;
    }

    if (msg.type === 'CONTEXT_REPLY') {
      (async () => {
        try {
          await requireFeature('context_reply', 'Screenshot Reply');
          addBreadcrumb('context_reply', 'User requested screenshot reply');
          const result = await handleContextReply(msg.payload);
          addBreadcrumb('context_reply', 'Screenshot reply received');
          sendResponse(result);
        } catch (err: any) {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('413') ? 'PAYLOAD_ERROR'
            : err.message?.includes('429') ? 'API_ERROR' : 'UNKNOWN';
          captureError(err instanceof Error ? err : new Error(String(err?.message || err)), { flow: 'CONTEXT_REPLY', errType });
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message || 'Screenshot reply unavailable. Try again.' });
        }
      })();
      return true;
    }

    if (msg.type === 'VOICE_REPLY') {
      (async () => {
        try {
          addBreadcrumb('voice_reply', 'User requested voice reply');
          const result = await handleVoiceReply(msg.payload);
          addBreadcrumb('voice_reply', 'Voice reply received');
          sendResponse(result);
        } catch (err: any) {
          const errType = err.message?.includes('License') ? 'AUTH_ERROR'
            : err.message?.includes('429') ? 'API_ERROR' : 'UNKNOWN';
          captureError(err instanceof Error ? err : new Error(String(err?.message || err)), { flow: 'VOICE_REPLY', errType });
          reportError(errType, err.message).catch(() => {});
          sendResponse({ error: err.message || 'Voice reply unavailable. Try again.' });
        }
      })();
      return true;
    }

    if (msg.type === 'OPEN_COMMAND_MODE') {
      void (async () => {
        try {
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            await browser.tabs.sendMessage(tabs[0].id, { type: 'OPEN_COMMAND_TAB' }).catch(() => {});
          }
        } catch {
          /* noop */
        }
      })();
      return false;
    }

    if (msg.type === 'SET_ALERT') {
      (async () => {
        try {
          const data = await browser.storage.local.get('brevmont_alerts');
          const alerts = data.brevmont_alerts || [];
          alerts.push({ id: Date.now().toString(), task: msg.payload.task, alertTime: msg.payload.alertTime, dismissed: false });
          await browser.storage.local.set({ brevmont_alerts: alerts });
          await logToolEvent('reminder_set', msg.payload.task || '', '', {
            reminder_time: msg.payload.alertTime ? new Date(msg.payload.alertTime).toISOString() : null,
            platform: msg.payload.platform || 'unknown',
            ...toolLeadMetadata(msg.payload, msg.payload.platform || 'unknown'),
          });
          sendResponse({ ok: true });
        } catch {
          sendResponse({ error: 'Failed to set alert' });
        }
      })();
      return true;
    }

    if (msg.type === 'DISMISS_ALERT') {
      browser.storage.local.get('brevmont_alerts').then(data => {
        const alerts = data.brevmont_alerts || [];
        const updated = alerts.map((a: any) => (
          a.id === msg.payload.id
            ? { ...a, dismissed: true, completed: true, completedAt: Date.now() }
            : a
        ));
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
      browser.storage.local.get(['dealer_token', 'rep_name']).then(async (settings) => {
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
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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
      browser.storage.local.get(['dealer_token', 'rep_name']).then(async (settings) => {
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
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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
      (async () => {
        try {
          await requireFeature('lead_capture', 'Lead capture');
          const dealerToken = await resolveDealerToken();
          if (!dealerToken && !msg.payload?.customer_name && !msg.payload?.name) {
            sendResponse({ error: 'No dealer_token' });
            return;
          }

          let data: any = {};
          if (dealerToken && msg.payload?.raw_text) {
            const resp = await signedFetch(`${PROXY_URL}/api/parse-lead`, {
              dealer_token: dealerToken,
              raw_text: msg.payload.raw_text,
              platform: msg.payload.platform || 'unknown',
            });
            data = await resp.json().catch(() => ({}));
            if (!resp.ok && !msg.payload?.customer_name && !msg.payload?.name) {
              sendResponse({ error: data?.error || `Lead parse failed (${resp.status})` });
              return;
            }
          }

          // Save parsed lead locally in Dexie for Lead Inbox
          const parsedLead = data.lead || {};
          const allowPartialFallback = shouldPersistPartialLead(msg.payload);
          const leadForSave = allowPartialFallback && (parsedLead.is_lead === false || parsedLead.intent === 'not_a_lead')
            ? {
                ...parsedLead,
                is_lead: true,
                intent: msg.payload?.vehicle_interest || msg.payload?.vehicle ? 'general_inquiry' : 'individual_buyer',
                confidence: parsedLead.confidence || 'low',
                notes: 'Low confidence — verify this is a customer',
              }
            : parsedLead;
          if ((parsedLead.is_lead === false || parsedLead.intent === 'not_a_lead') && !allowPartialFallback) {
            sendResponse(data);
            return;
          }
          const looseFallback = parseLooseLeadText(msg.payload?.raw_text);
          const fallbackName =
            msg.payload?.customer_name ||
            msg.payload?.customerName ||
            msg.payload?.name ||
            looseFallback.customer_name ||
            null;
          const parsedName = !isBadLeadName(leadForSave.customer_name)
            ? leadForSave.customer_name
            : !isBadLeadName(leadForSave.name)
              ? leadForSave.name
              : null;
          const customerName = parsedName || fallbackName;

          if (customerName) {
            const leadId = crypto.randomUUID();
            const localHeatScore = inferLocalLeadHeat(leadForSave, msg.payload);
            const customerRecord = await resolveCustomerForContext({
              name: customerName,
              phone: leadForSave.phone || msg.payload?.phone || null,
              email: leadForSave.email || msg.payload?.email || null,
              vehicle_interest: leadForSave.vehicle_interest || msg.payload?.vehicle_interest || msg.payload?.vehicle || looseFallback.vehicle_interest || null,
              source: msg.payload.platform || 'unknown',
            });
            const localLead: LocalLead = {
              id: leadId,
              customer_id: customerRecord?.id || null,
              customer_name: customerName,
              phone: leadForSave.phone || msg.payload?.phone || null,
              email: leadForSave.email || msg.payload?.email || null,
              vehicle_interest: leadForSave.vehicle_interest || msg.payload?.vehicle_interest || msg.payload?.vehicle || looseFallback.vehicle_interest || null,
              source_platform: msg.payload.platform || 'unknown',
              source_raw_text: (msg.payload.raw_text || '').slice(0, 5000),
              status: 'captured',
              captured_at: Date.now(),
              sync_status: 'pending',
              updated_at: Date.now(),
              has_trade_in: leadForSave.has_trade_in || false,
              finance_intent: leadForSave.finance_intent || false,
              extracted_trade_in: leadForSave.extracted_trade_in || leadForSave.trade_in_vehicle || null,
              extracted_urgency: leadForSave.extracted_urgency || leadForSave.urgency || null,
              pipeline_stage: 'captured',
              lead_stage_at_capture: msg.payload?.lead_stage_at_capture || null,
              heat_score: localHeatScore,
              metadata: {
                company: leadForSave.company || null,
                intent: leadForSave.intent || null,
                confidence: leadForSave.confidence || null,
                is_lead: leadForSave.is_lead !== false,
                lead_stage_at_capture: msg.payload?.lead_stage_at_capture || null,
                customer_id: customerRecord?.id || null,
              },
            };
            await leadDb.captured_leads.put(localLead);
            // Fire-and-forget background sync
            syncPendingLeads().catch((e) => console.warn('[leadSync] bg sync failed:', e));
            data = {
              ...data,
              lead: {
                ...leadForSave,
                id: leadId,
                customer_id: customerRecord?.id || null,
                customer_name: customerName,
                phone: localLead.phone,
                email: localLead.email,
                vehicle_interest: localLead.vehicle_interest,
                source_platform: localLead.source_platform,
                source_raw_text: localLead.source_raw_text,
                status: localLead.status,
                pipeline_stage: localLead.pipeline_stage,
                heat_score: localLead.heat_score,
                has_trade_in: localLead.has_trade_in,
                finance_intent: localLead.finance_intent,
                extracted_trade_in: localLead.extracted_trade_in,
                extracted_urgency: localLead.extracted_urgency,
                company: leadForSave.company || null,
                intent: leadForSave.intent || null,
                confidence: leadForSave.confidence || null,
                is_lead: leadForSave.is_lead !== false,
                lead_stage_at_capture: localLead.lead_stage_at_capture || null,
              },
            };
            if (customerRecord?.id) {
              customerStamp({
                customer_id: customerRecord.id,
                action_type: 'lead_capture',
                input_text: localLead.source_raw_text,
                vehicle_context: localLead.vehicle_interest,
                detection_method: 'auto_page',
                detection_confidence: 1,
                captured_lead_id: leadId,
              }).catch(() => {});
            }
          }

          sendResponse(data);
        } catch (e: any) {
          telemetry.trackError(e, { flow: 'parse_lead' });
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    // ── Lead Inbox: GET_LOCAL_LEADS — return all local leads from Dexie ──
    if (msg.type === 'UPDATE_LOCAL_LEAD_STAGE_AT_CAPTURE') {
      (async () => {
        try {
          const { leadId, stage } = msg.payload || {};
          if (!leadId || !stage) { sendResponse({ error: 'Missing leadId or stage' }); return; }
          const lead = await leadDb.captured_leads.get(leadId);
          const metadata = { ...(lead?.metadata || {}), lead_stage_at_capture: stage };
          await leadDb.captured_leads.update(leadId, {
            lead_stage_at_capture: stage,
            metadata,
            sync_status: 'pending',
            updated_at: Date.now(),
          });
          syncPendingLeads().catch((e) => console.warn('[leadSync] stage-at-capture sync failed:', e));
          sendResponse({ ok: true });
        } catch (e: any) {
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_LOCAL_LEADS') {
      (async () => {
        try {
          const leads = await leadDb.captured_leads
            .orderBy('captured_at')
            .reverse()
            .limit(100)
            .toArray();
          const stats = await getSyncStats();
          sendResponse({ leads, stats });
        } catch (e: any) {
          sendResponse({ leads: [], stats: { pending: 0, synced: 0, error: 0 }, error: e.message });
        }
      })();
      return true;
    }

    // ── Lead Inbox: UPDATE_LEAD_STATUS — update local lead status + sync ──
    if (msg.type === 'UPDATE_LEAD_STATUS') {
      (async () => {
        try {
          const { leadId, status } = msg.payload;
          if (!leadId || !status) { sendResponse({ error: 'Missing leadId or status' }); return; }

          await leadDb.captured_leads.update(leadId, {
            status,
            sync_status: 'pending',
            updated_at: Date.now(),
            ...(status === 'logged_to_crm' ? { logged_at: Date.now() } : {}),
            ...(status === 'enriched' ? { enriched_at: Date.now() } : {}),
          });

          // Sync immediately
          syncPendingLeads().catch((e) => console.warn('[leadSync] status sync failed:', e));

          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    // ── Lead Intelligence: CHANGE_LEAD_STAGE — advance/regress pipeline stage via API ──
    if (msg.type === 'CHANGE_LEAD_STAGE') {
      (async () => {
        try {
          const { leadId, stage, appointment_at, lost_reason, lost_reason_detail } = msg.payload || {};
          if (!leadId || !stage) { sendResponse({ error: 'Missing leadId or stage' }); return; }

          const resp = await signedPatch(`${PROXY_URL}/api/v1/leads/${leadId}/stage`, {
            stage,
            appointment_at,
            lost_reason,
            lost_reason_detail,
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            sendResponse({ error: err.error || `HTTP ${resp.status}` });
            return;
          }

          const data = await resp.json();
          const lead = data.lead || data;

          // Update local DB if lead exists there
          try {
            await leadDb.captured_leads.update(leadId, {
              pipeline_stage: stage,
              ...(appointment_at ? { appointment_at } : {}),
              ...(lost_reason ? { lost_reason } : {}),
              ...(lost_reason_detail !== undefined ? { lost_reason_detail: lost_reason_detail || null } : {}),
              ...(stage === 'lost' ? { lost_at: lead.lost_at || data.lost_at || new Date().toISOString() } : {}),
              sync_status: 'synced',
              updated_at: Date.now(),
            });
          } catch { /* lead may not be in local DB — that's fine */ }

          sendResponse({ success: true, lead });
        } catch (e: any) {
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    // ── Lead Inbox: SYNC_LEADS — manual sync trigger ──
    if (msg.type === 'GET_MY_LEADS') {
      (async () => {
        try {
          const stage = msg.payload?.stage ? `?stage=${encodeURIComponent(String(msg.payload.stage))}` : '';
          const resp = await signedGet(`${PROXY_URL}/api/v1/rep/leads${stage}`);
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || `My Leads API returned ${resp.status}`);
          sendResponse(data);
        } catch (e: any) {
          sendResponse({ leads: [], error: e.message });
        }
      })();
      return true;
    }

    if (msg.type === 'GET_REP_CHALLENGES') {
      (async () => {
        try {
          const resp = await signedGet(`${PROXY_URL}/api/v1/rep/challenges`);
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || `Challenges API returned ${resp.status}`);
          sendResponse(data);
        } catch (e: any) {
          sendResponse({ challenges: [], error: e.message });
        }
      })();
      return true;
    }

    if (msg.type === 'SYNC_LEADS') {
      (async () => {
        try {
          const result = await syncPendingLeads();
          sendResponse(result);
        } catch (e: any) {
          sendResponse({ synced: 0, failed: 0, error: e.message });
        }
      })();
      return true;
    }

    if (msg.type === 'MARK_EMAIL_APPLIED') {
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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

    // ===== Side Panel: honest event logging (no direct import from extension page) =====
    if (msg.type === 'LOG_HONEST_EVENT') {
      (async () => {
        try {
          const settings = await browser.storage.local.get(['dealer_token']);
          const local = await browser.storage.local.get(['dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']);
          const token = settings.dealer_token || local.dealer_token;
          const repToken = local.rep_auth_token || local.brevmont_rep_auth_token;
          const version = chrome.runtime.getManifest()?.version || 'unknown';
          const payload = { ...msg.payload, ext_version: version };
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          if (repToken) headers['X-Rep-Token'] = repToken;
          const resp = await fetch(`${PROXY_URL}/api/v1/events`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || `event_log_failed_${resp.status}`);
          }
          sendResponse({ ok: true });
        } catch (e: any) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }

    // ===== Side Panel: rep stats (content.ts does direct fetch; Side Panel goes through background) =====
    if (msg.type === 'GET_REP_STATS') {
      (async () => {
        try {
          const syncSettings = await browser.storage.local.get(['dealer_token', 'rep_name', 'rep_auth_token']);
          const localSettings = await browser.storage.local.get(['dealer_token', 'rep_name', 'rep_auth_token', 'brevmont_rep_auth_token']);
          const dealerToken = syncSettings.dealer_token || localSettings.dealer_token;
          const repToken = syncSettings.rep_auth_token || localSettings.rep_auth_token || localSettings.brevmont_rep_auth_token;
          const repName = syncSettings.rep_name || localSettings.rep_name;
          const authToken = repToken || dealerToken;
          if (!authToken || (!repToken && !repName)) { sendResponse({ error: 'no_token' }); return; }
          const qs = repName ? `?rep_name=${encodeURIComponent(repName)}` : '';
          const resp = await fetch(`${PROXY_URL}/v1/rep/stats${qs}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
          });
          if (!resp.ok) throw new Error(`Stats API returned ${resp.status}`);
          const data = await resp.json();
          sendResponse(data);
        } catch (e: any) {
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }

    // ===== Intelligence: DOM discovery telemetry =====
    if (msg.type === 'TELEMETRY_DOM_DISCOVERY') {
      browser.storage.local.get(['dealer_token']).then(async (settings) => {
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

    // ===== CONTENT_SCRIPT_READY — content script loaded on a platform =====
    if (msg.type === 'CONTENT_SCRIPT_READY') {
      dlog('[Brevmont] Content script ready on', msg.payload?.platform, 'tab', sender?.tab?.id);
      return false;
    }

    // ===== CAPTURE_SCREENSHOT — side panel requests visible tab capture =====
    if (msg.type === 'CAPTURE_SCREENSHOT') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const windowId = typeof activeTab?.windowId === 'number' ? activeTab.windowId : undefined;
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 });
          sendResponse({ image: dataUrl });
        } catch (e: any) {
          let pageText = '';
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab?.id) {
              const ctx = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_CONVERSATION_TEXT' }).catch(() => null);
              const lead = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_LEAD_CONTEXT' }).catch(() => null);
              const bits = [
                ctx?.text ? `Visible conversation text: ${String(ctx.text).slice(0, 5000)}` : '',
                lead?.customerName ? `Customer: ${lead.customerName}` : '',
                lead?.vehicle || lead?.vehicleOfInterest ? `Vehicle: ${lead.vehicle || lead.vehicleOfInterest}` : '',
                lead?.source ? `Source: ${lead.source}` : '',
              ].filter(Boolean);
              pageText = bits.join('\n');
            }
          } catch {}
          if (pageText) {
            sendResponse({
              image: BLANK_CONTEXT_IMAGE,
              fallback: 'page_text',
              page_text: pageText,
              warning: e.message || 'Screenshot capture unavailable; using visible page text.',
            });
            return;
          }
          sendResponse({ error: e.message || 'Screenshot capture failed' });
        }
      })();
      return true;
    }

    // ===== OPEN_MIC_SETUP — side panel requests mic permission bootstrap =====
    if (msg.type === 'OPEN_MIC_SETUP') {
      browser.windows.create({
        url: browser.runtime.getURL('permission.html'),
        type: 'popup', width: 420, height: 340, focused: true,
      }).catch(() => {
        browser.tabs.create({ url: browser.runtime.getURL('permission.html') }).catch(() => {});
      });
      sendResponse({ ok: true });
      return false;
    }

    // ===== MIC_PERMISSION_GRANTED — permission page notifies grant =====
    if (msg.type === 'MIC_PERMISSION_GRANTED') {
      // Storage flag already set by permission page; this message lets
      // the side panel react immediately via onMessage listener.
      dlog('[Brevmont] Mic permission granted');
      return false;
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
    const settings = await browser.storage.local.get(['dealer_token', 'rep_name']);
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
      const settings = await browser.storage.local.get(['dealer_token', 'rep_name', 'dealership']);
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
        const previous = await browser.storage.local.get(['brevmont_tier']);
        const storageUpdate: Record<string, any> = {
          brevmont_tier: tier,
          dealership_tier: tier,
          brevmont_features: data.features || getTierFeatures(tier),
          brevmont_last_heartbeat: Date.now(),
        };
        // Store usage data for free tier counter display
        if (data.usage) {
          storageUpdate.brevmont_usage = data.usage;
        }
        await browser.storage.local.set(storageUpdate);
        if (previous.brevmont_tier && previous.brevmont_tier !== tier) {
          browser.runtime.sendMessage({ type: 'TIER_CHANGED', tier }).catch(() => {});
        }
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
  // Phase 2 (2026-05-06): chrome.storage.local-backed honest-events queue
  // drain. Survives MV3 SW respawn unlike the prior setInterval inside
  // the honestEvents module. The alarm fires every 60s and the handler
  // imports flushQueue dynamically so failed imports don't crash boot.
  browser.alarms.create('brevmont-honest-drain', { periodInMinutes: 1 });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'brevmont-heartbeat') void sendHeartbeat();
    else if (alarm.name === 'brevmont-check-alerts') void checkAlerts();
    else if (alarm.name === 'brevmont-queue-flush') {
      void getResolvedApiUrl().then((u) => processQueue(u).catch(() => {}));
    } else if (alarm.name === 'brevmont-honest-drain') {
      // Honest-events queue drain (chrome.storage.local-backed).
      void import('./lib/honestEvents')
        .then((mod) => (mod.flushQueue ? mod.flushQueue() : Promise.resolve()))
        .catch(() => {});
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
  // Previous builds mirrored dealer_token into chrome.storage.sync. Keep this
  // as a cleanup shim so auth tokens live in local storage only.
  async function healDealerTokenSync() {
    try {
      const sync = await browser.storage.sync.get([
        'dealer_token',
        'rep_auth_token',
        'brevmont_rep_auth_token',
        'license_secret',
        'brevmont_license_secret',
      ]);
      const local = await browser.storage.local.get(['dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']);
      const syncVal = sync?.dealer_token as string | undefined;
      const localVal = local?.dealer_token as string | undefined;
      const localPatch: Record<string, string> = {};
      if (!localVal && syncVal) localPatch.dealer_token = syncVal as string;
      if (!local.rep_auth_token && sync.rep_auth_token) localPatch.rep_auth_token = sync.rep_auth_token as string;
      if (!local.brevmont_rep_auth_token && sync.brevmont_rep_auth_token) localPatch.brevmont_rep_auth_token = sync.brevmont_rep_auth_token as string;
      if (Object.keys(localPatch).length) await browser.storage.local.set(localPatch);
      if (syncVal || sync.rep_auth_token || sync.brevmont_rep_auth_token || sync.license_secret || sync.brevmont_license_secret) {
        await browser.storage.sync.remove([
          'dealer_token',
          'rep_auth_token',
          'brevmont_rep_auth_token',
          'license_secret',
          'brevmont_license_secret',
        ]);
        await browser.storage.local.remove(['license_secret', 'brevmont_license_secret']);
        dlog('[Brevmont] moved legacy sync auth tokens to local storage');
      }
    } catch (err) {
      console.warn('[Brevmont] dealer_token heal error:', (err as Error).message);
    }
  }

  // ===== AUTH HARDENING: Bootstrap license secret =====
  // Phase 3 (2026-05-06): /v1/license/secret returns 410 Gone. JWT auth
  // via /api/v1/auth/token replaced HMAC signing. We keep the function
  // shape so existing call sites compile, but it now only clears stale
  // brevmont_license_secret values from prior installs to free storage
  // and avoid confusion in the inspector. The actual auth path is
  // handled by lib/jwtCache.ts via getJWT(apiBase) on first signedFetch.
  async function bootstrapLicenseSecret() {
    try {
      const existing = await browser.storage.local.get(['brevmont_license_secret']);
      if (existing.brevmont_license_secret) {
        await browser.storage.local.remove(['brevmont_license_secret']);
        dlog('[Brevmont] Phase 3: cleared legacy license_secret (JWT auth replaces HMAC)');
      }
    } catch (err) {
      console.warn('[Brevmont] License secret cleanup error:', (err as Error).message);
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

      // Read the cookie set by /join/:id/complete OR /activate/:token on app.brevmont.com.
      const cookie = await browser.cookies.get({
        url: 'https://app.brevmont.com',
        name: 'brevmont_rep_session',
      });
      if (!cookie?.value) return false;

      const cookieValue = cookie.value;

      // Two paths converge here:
      // 1. Install token (from /activate page): value starts with "inst_"
      //    → call POST /v1/install-tokens/validate (consumes the token)
      // 2. Rep auth token (from /join/:id/complete): any other value
      //    → call GET /api/session/to-license with Bearer auth
      let data: {
        license_key?: string;
        license_secret?: string;
        dealer_token?: string;
        rep_auth_token?: string;
        dealership_id?: string;
        dealership_name?: string;
        rep_email?: string;
        rep_name?: string;
        rep_id?: string;
        tier?: string;
        plan?: string;
      };

      if (cookieValue.startsWith('inst_')) {
        // Install token path — one-click activation from /activate page
        const resp = await fetchWithRetry(`${PROXY_URL}/v1/install-tokens/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: cookieValue }),
        });
        if (!resp.ok) {
          console.warn('[Brevmont] install-token validate returned', resp.status);
          return false;
        }
        data = await resp.json() as typeof data;
      } else {
        // Legacy rep auth token path
        const resp = await fetchWithRetry(`${PROXY_URL}/api/session/to-license`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${cookieValue}` },
        });
        if (!resp.ok) {
          console.warn('[Brevmont] auto-config bridge returned', resp.status);
          return false;
        }
        data = await resp.json() as typeof data;
      }

      if (!data.license_key) return false;

      const dealerToken = data.dealer_token || data.license_key;
      const repAuthToken = data.rep_auth_token || cookieValue;
      const repName = data.rep_name || data.rep_email || 'Rep';
      const dealershipName = data.dealership_name || '';

      // Local storage is the activation gate used by the install screen,
      // toolbar click, side panel, and onboarding fallback. If these keys are
      // missing, the rep gets sent into the owner wizard even though the
      // cookie handoff worked.
      await browser.storage.local.set({
        license_key: data.license_key,
        dealer_token: dealerToken,
        rep_auth_token: repAuthToken,
        brevmont_rep_auth_token: repAuthToken,
        dealership_id: data.dealership_id || '',
        dealership: dealershipName,
        rep_email: data.rep_email || '',
        rep_name: repName,
        rep_id: data.rep_id || '',
        brevmont_tier: data.tier || 'free',
        dealership_tier: data.tier || 'free',
        dealership_plan: data.plan || data.tier || 'free',
        brevmont_features: getTierFeatures(data.tier || 'free'),
        profile_onboarded: false,
        profile_onboarding: null,
        activated_at: Date.now(),
        license_revoked: false,
        brevmont_extension_role: 'rep',
      });
      await browser.storage.local.remove(SETUP_KEY);
      await browser.storage.local.remove(['license_revoked_at', 'license_revoked_message']);

      await browser.storage.sync.set(storage.sanitizeSyncPayload({
        dealer_token: dealerToken,
        rep_auth_token: repAuthToken,
        rep_name: repName,
        dealership: dealershipName,
        dealership_id: data.dealership_id || '',
        brevmont_tier: data.tier || 'free',
        dealership_tier: data.tier || 'free',
        dealership_plan: data.plan || data.tier || 'free',
        profile_onboarded: false,
        brevmont_extension_role: 'rep',
      }));
      await browser.storage.sync.remove(['profile_onboarding']);

      // Clear the cookie after successful activation — one-time use.
      try {
        await browser.cookies.remove({
          url: 'https://app.brevmont.com',
          name: 'brevmont_rep_session',
        });
      } catch {
        // Non-fatal if cookie removal fails
      }

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
      const settings = await browser.storage.local.get(['dealer_token']);

      const publicStatus = await fetch(
        `${PROXY_URL}/api/extension-status?current_version=${encodeURIComponent(manifest.version || 'unknown')}`,
        { headers: { 'X-Extension-Version': manifest.version || 'unknown' } },
      ).then((r) => (r.ok ? r.json() : null)).catch(() => null);

      if (publicStatus && typeof publicStatus === 'object') {
        const updateRequired = Boolean(publicStatus.update_required || publicStatus.required);
        const forceUpdate = Boolean(publicStatus.force_update);
        await browser.storage.local.set({
          brevmont_version_status: {
            locked: forceUpdate,
            deprecated: updateRequired && !forceUpdate,
            updateRequired,
            forceUpdate,
            message: String(publicStatus.update_message || (forceUpdate ? 'Please update Brevmont to continue.' : 'A new version of Brevmont is available.')),
            latest: publicStatus.latest || publicStatus.version || null,
            downloadUrl: publicStatus.download_url || `${PROXY_URL}/api/extension-download`,
          }
        });
        return;
      }

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
          updateRequired: belowMinimum || Boolean(data.deprecated),
          forceUpdate: belowMinimum,
          deprecated: data.deprecated,
          message: belowMinimum
            ? `Version ${manifest.version} is no longer supported. Please update to ${data.latest_version}.`
            : data.deprecated ? data.deprecation_notice : null,
          latest: data.latest_version,
          downloadUrl: `${PROXY_URL}/api/extension-download`,
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

    const alreadySetup = await hasCompleteActivation();

    // Updates / reloads: never pop install UI if they're already activated.
    if (details.reason === 'update' && alreadySetup) {
      sendHeartbeat().catch(() => {});
      setTimeout(bootstrapLicenseSecret, 5000);
      setTimeout(checkVersionStatus, 8000);
      return;
    }

    if (autoConfigured) {
      // Cookie share landed. Fire heartbeat now so the ACTIVATED Telegram
      // alert lands immediately instead of after the 5-min cron tick.
      sendHeartbeat().catch(() => {});

      // Cookie auto-config means the rep is also seeing the install screen
      // for the first time. Show the "Find Brevmont in Chrome" walkthrough
      // so they can pin the icon — without it, they'll lose the toolbar
      // affordance and assume the extension isn't installed.
      if (details.reason === 'install' && !alreadySetup) {
        try {
          await browser.tabs.create({ url: BREVMONT_WELCOME_URL });
          await browser.tabs.create({ url: browser.runtime.getURL('install-screen.html') });
        } catch {
          // ignore; the wizard fallback below would not run anyway because
          // autoConfigured = true
        }
      }
    } else if (details.reason === 'install' && !alreadySetup) {
      // Auto-config didn't land (no cookie, or bridge call failed). Show
      // the "Find Brevmont in Chrome" walkthrough first — same screen the
      // cookie path shows — so the rep pins the icon. After that walkthrough
      // they can click "I pinned it" which routes them to the legacy
      // onboarding wizard (fallback bootstrap path).
      try {
        await browser.tabs.create({ url: BREVMONT_WELCOME_URL });
        await browser.tabs.create({ url: browser.runtime.getURL('install-screen.html') });
      } catch {
        // Final fallback — permission page (mic + setup gate).
        browser.tabs.create({ url: browser.runtime.getURL('permission.html') }).catch(() => {});
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
  if (body?.error === 'license_revoked' || body?.error === 'rep_token_revoked' || body?.error === 'rep_token_expired') {
    const msg = body?.message || body?.error_message ||
      (body?.error === 'license_revoked'
        ? 'Your Brevmont license has been revoked. Contact support.'
        : 'Your access at this dealership has ended. Been invited to a new store? Reconnect below.');
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

/** Dealer license: local storage only; sync storage must not carry auth tokens. */
async function resolveDealerToken(): Promise<string> {
  const local = await browser.storage.local.get(['dealer_token']);
  return String(local.dealer_token || '');
}

async function handleGenerate(payload: {
  type: string;
  leadContext: any;
  repInput: string;
  repName: string;
  dealership: string;
  platform?: string;
  metadata?: Record<string, any>;
}) {
  // Phase T7: block generation outright if license is revoked
  await assertNotRevoked();
  const settings = await browser.storage.local.get(['rep_auth_token']);
  const dealerToken = await resolveDealerToken();
  const { repName, dealership, contextBlock } = await buildRepContext();

  const finalRepName = payload.repName || repName;
  const finalDealership = payload.dealership || dealership;
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

  // Structured metadata for generation_events logging (sent alongside the prompt).
  // generation_id is generated here and propagated to the proxy so the server-side
  // event_log_v2 UPSERT lands on the same row the extension's logEvent() (sync
  // honest tracker) wrote — single row carries everything for dashboards + async
  // enrichment.
  const generationId =
    (payload?.metadata?.generation_id && typeof payload.metadata.generation_id === 'string'
      ? payload.metadata.generation_id
      : null) || (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const metadata: any = {
    rep_name: finalRepName,
    workflow_type: payload.metadata?.workflow_type || payload.type || 'all',
    customer_name: customerName,
    customer_phone: payload.metadata?.customer_phone || payload.leadContext?.phone || null,
    customer_email: payload.metadata?.customer_email || payload.leadContext?.email || null,
    vehicle: payload.metadata?.vehicle || payload.leadContext?.vehicle || null,
    vehicle_make: payload.metadata?.vehicle_make || null,
    vehicle_model: payload.metadata?.vehicle_model || null,
    vehicle_of_interest: payload.metadata?.vehicle_of_interest || null,
    generation_id: generationId,
    lead_id: payload.lead_id || payload.metadata?.lead_id || null,
    customer_id: payload.metadata?.customer_id || payload.leadContext?.customer_id || null,
    detection_method: payload.metadata?.detection_method || payload.leadContext?.detectionMethod || payload.leadContext?.detection_method || null,
    detection_confidence: payload.metadata?.detection_confidence ?? payload.leadContext?.detectionConfidence ?? payload.leadContext?.detection_confidence ?? null,
    vehicle_context: payload.metadata?.vehicle_context || payload.leadContext?.vehicle_context || payload.leadContext?.vehicle || null,
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

    // Free tier generation limit reached — return structured response for upgrade prompt
    if (m.startsWith('GENERATION_LIMIT:')) {
      try {
        const data = JSON.parse(m.slice('GENERATION_LIMIT:'.length));
        // Update stored usage so the counter refreshes immediately
        await browser.storage.local.set({
          brevmont_usage: {
            generations_used: data.used || data.limit || 500,
            generations_limit: data.limit || 500,
            generations_remaining: 0,
            resets_at: data.resets_at || null,
          },
        });
        return {
          generation_limit_reached: true,
          message: data.message || `You've used all ${data.limit || 500} free follow-ups this month.`,
          limit: data.limit || 500,
          used: data.used || data.limit || 500,
          resets_at: data.resets_at || null,
          upgrade_url: data.upgrade_url || 'https://brevmont.com',
        };
      } catch { /* fall through to re-throw */ }
    }

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
    customer_phone?: string | null;
    customer_email?: string | null;
    vehicle?: string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_of_interest?: string | null;
    generation_id?: string | null;
    lead_id?: string | null;
    customer_id?: string | null;
    detection_method?: string | null;
    detection_confidence?: number | string | null;
    vehicle_context?: string | null;
  }
) {
  return {
    dealer_token: dealerToken,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 700,
    model: 'claude-haiku-4-5-20251001',
    stream: true,
    platform: platform,
    rep_name: metadata?.rep_name ?? null,
    workflow_type: metadata?.workflow_type ?? null,
    customer_name: metadata?.customer_name ?? null,
    customer_phone: metadata?.customer_phone ?? null,
    customer_email: metadata?.customer_email ?? null,
    vehicle: metadata?.vehicle ?? null,
    vehicle_make: metadata?.vehicle_make ?? null,
    vehicle_model: metadata?.vehicle_model ?? null,
    vehicle_of_interest: metadata?.vehicle_of_interest ?? null,
    generation_id: metadata?.generation_id ?? null,
    lead_id: metadata?.lead_id ?? null,
    customer_id: metadata?.customer_id ?? null,
    detection_method: metadata?.detection_method ?? null,
    detection_confidence: metadata?.detection_confidence ?? null,
    vehicle_context: metadata?.vehicle_context ?? metadata?.vehicle ?? null,
  };
}

function emitGenerationStream(generationId: string | null | undefined, event: string, payload: Record<string, unknown> = {}) {
  browser.runtime.sendMessage({
    type: 'GENERATION_STREAM',
    generation_id: generationId || null,
    event,
    ...payload,
  }).catch(() => {});
}

async function readGenerationStream(resp: Response, generationId?: string | null, target = 'generation'): Promise<any> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('Streaming response unavailable. Please try again.');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: any = null;
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const event = frame.split(/\n/).find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
      const dataLine = frame.split(/\n/).find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (!raw) continue;
      const payload = JSON.parse(raw);

      if (event === 'start') {
        emitGenerationStream(generationId || payload.generation_id, 'start', { ...payload, target });
      } else if (event === 'delta') {
        const text = String(payload.text || '');
        fullText += text;
        emitGenerationStream(generationId, 'delta', { text, target });
      } else if (event === 'done') {
        finalPayload = payload;
        emitGenerationStream(generationId, 'done', { ...payload, target });
      } else if (event === 'error') {
        throw new Error(String(payload.error || 'Generation failed'));
      }
    }
  }

  if (!finalPayload) {
    finalPayload = { content: [{ type: 'text', text: fullText }], usage: {} };
  }
  return finalPayload;
}

async function handleGenerationStatus(): Promise<any> {
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const resp = await signedGet(`${base}/v1/generate/status`);
  await handleRevocationResponse(resp);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `status_${resp.status}`);
  }

  const limit = Number(data.limit ?? data.generations_limit ?? 500);
  const used = Number(data.used ?? data.generations_used ?? 0);
  const remaining = Number(data.remaining ?? Math.max(0, limit - used));
  const tier = String(data.tier || 'free_trial');
  await browser.storage.local.set({
    brevmont_tier: tier,
    brevmont_usage: {
      generations_used: used,
      generations_limit: limit,
      generations_remaining: remaining,
      resets_at: data.resets_at || null,
    },
  });
  await updateFreeTierBadge({ remaining }, tier);
  return { tier, limit, used, remaining, resets_at: data.resets_at || null };
}

async function handleInviteGm(payload: any): Promise<any> {
  const gmEmail = String(payload?.gm_email || payload?.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gmEmail)) {
    throw new Error('Enter a valid GM email.');
  }
  const base = (await getResolvedApiUrl()).replace(/\/$/, '');
  const resp = await signedFetch(`${base}/api/v1/invite-gm`, { gm_email: gmEmail });
  await handleRevocationResponse(resp);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('You already sent a GM request this month.');
    throw new Error(data?.error || `invite_${resp.status}`);
  }
  return data;
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
  const generationId = body.generation_id || metadata?.generation_id || crypto.randomUUID();
  body.generation_id = generationId;
  const streamTarget = metadata?.stream_target || (platform === 'coach' ? 'coach' : platform === 'command' ? 'command' : 'generation');

  const extraHeaders: Record<string, string> = {};
  if (repAuthToken) extraHeaders['X-Rep-Token'] = repAuthToken;
  if (idempotencyKey) extraHeaders['X-Idempotency-Key'] = idempotencyKey;
  // X-Extension-Version stamps the running build on every /v1/generate so
  // the early-block event_log_v2 UPSERT (routes/generation.js) can record
  // ext_version on generation.created rows. Without this header the row
  // lands with action_metadata.ext_version = null even though .copied/
  // .pasted/.send_clicked events stamp it correctly via honestEvents.
  try {
    const v = chrome.runtime.getManifest()?.version;
    if (typeof v === 'string' && v.length > 0) extraHeaders['X-Extension-Version'] = v;
  } catch { /* manifest unavailable; skip header */ }
  extraHeaders.Accept = 'text/event-stream';
  const mergedExtra = Object.keys(extraHeaders).length ? extraHeaders : undefined;

  const resp = await signedFetch(`${base}/v1/generate`, body, mergedExtra);

  // Phase T7: detect revocation responses
  await handleRevocationResponse(resp);

  if (resp.status === 202) {
    // Async mode — poll for result from BullMQ queue
    const { job_id } = await resp.json();
    const result = await pollForResult(job_id, GENERATION_POLL_TIMEOUT_MS, base);
    const text = result.content?.[0]?.text || '';
    if (!text) throw new Error('Empty response from AI. Please try again.');
    return { text, usage: result.usage || {} };
  }

  if (resp.status === 401) throw new Error('Your Brevmont access expired or needs to be refreshed. Sign in with Google again, or text us at 307-690-0291.');
  if (resp.status === 429) {
    const body429 = await resp.json().catch(() => ({}));
    if (body429.error === 'generation_limit_reached') {
      throw new Error(`GENERATION_LIMIT:${JSON.stringify(body429)}`);
    }
    if (body429.error === 'daily_limit_reached') {
      throw new Error(body429.message || "You've hit your daily follow-up limit. This resets tomorrow morning.");
    }
    throw new Error('Too many requests. Wait a few seconds and try again.');
  }
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'Unknown error' }));
    if (resp.status >= 500) throw new Error(`HTTP_${resp.status}`);
    throw new Error(errBody.error || `Proxy error: ${resp.status}`);
  }

  const isStream = String(resp.headers.get('content-type') || '').includes('text/event-stream');
  const data = isStream
    ? await readGenerationStream(resp, generationId, streamTarget)
    : await resp.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Empty response from AI. Please try again.');
  if (data?.brevmont_usage) await updateFreeTierBadge(data.brevmont_usage, data.tier);
  void claimReferralAfterFirstGeneration();

  return { text, usage: data.usage || {}, brevmont_usage: data.brevmont_usage || null, tier: data.tier || null };
}

// Poll for async generation result from BullMQ queue
async function pollForResult(jobId: string, maxWait = GENERATION_POLL_TIMEOUT_MS, apiBase: string = PROXY_URL): Promise<any> {
  const base = apiBase.replace(/\/$/, '');
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 500));
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

// --- Coach via /v1/generate ---
// Routes through the same generateViaProxy pipeline that powers the main
// Generate button. The proxy's system prompt handles automotive coaching
// context; we just wrap the objection in an instruction prefix.
async function handleCoach(payload: { situation: string; vehicleContext?: string; platform?: string; leadContext?: Record<string, any> }) {
  const settings = await browser.storage.local.get(['rep_auth_token']);
  const dealerToken = await resolveDealerToken();
  const { repName, dealership, contextBlock } = await buildRepContext();
  if (!dealerToken) throw new Error('No license key found. Complete onboarding at brevmont.com.');

  let repAuthToken: string = (settings.rep_auth_token as string | undefined) || '';
  if (!repAuthToken) {
    try {
      const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
      repAuthToken = (local.rep_auth_token as string | undefined)
        || (local.brevmont_rep_auth_token as string | undefined)
        || '';
    } catch {}
  }

  const leadMeta = toolLeadMetadata(payload, payload.platform);
  const vehicleCtx = (payload.vehicleContext || leadMeta.vehicle) ? `\nVehicle context: ${payload.vehicleContext || leadMeta.vehicle}` : '';
  const customerCtx = leadMeta.customer_name ? `\nCustomer: ${leadMeta.customer_name}` : '';
  const coachMessage = `[COACHING MODE — Do NOT generate customer-facing copy. Instead, coach the sales rep on how to handle this situation.]

Rep: ${repName}
Dealership: ${dealership}
${contextBlock}${customerCtx}${vehicleCtx}

The customer said: "${payload.situation}"

Answer like a veteran floor manager talking to a rep between ups. No bullets. No academic framing. No "it usually means." Keep it direct, punchy, and practical.

Give them exactly what to do next and one line they can say back.

Keep it to 3-5 short sentences.`;

  const apiBase = await getResolvedApiUrl();
  const result = await generateViaProxy(
    dealerToken,
    coachMessage,
    'coach',
    { ...leadMeta, rep_name: repName, workflow_type: 'coach', stream_target: 'coach' },
    repAuthToken,
    undefined,
    apiBase
  );
  await logToolEvent('coach_me', payload.situation || '', result.text, {
    ...leadMeta,
    objection_category: objectionCategoryFromText(payload.situation),
    parsed_vehicle: payload.vehicleContext || leadMeta.vehicle || null,
  });
  return { coaching: result.text };
}

// --- Ask Anything (Command Mode) via /v1/generate ---
async function handleCommand(payload: { command: string; currentUrl?: string; vehicleContext?: string; platform?: string; leadContext?: Record<string, any> }) {
  const settings = await browser.storage.local.get(['rep_auth_token']);
  const dealerToken = await resolveDealerToken();
  const { repName, dealership, contextBlock } = await buildRepContext();
  if (!dealerToken) throw new Error('No license key found. Complete onboarding at brevmont.com.');

  let repAuthToken: string = (settings.rep_auth_token as string | undefined) || '';
  if (!repAuthToken) {
    try {
      const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
      repAuthToken = (local.rep_auth_token as string | undefined)
        || (local.brevmont_rep_auth_token as string | undefined)
        || '';
    } catch {}
  }

  const leadMeta = toolLeadMetadata(payload, payload.platform);
  const vehicleCtx = (payload.vehicleContext || leadMeta.vehicle) ? `\nVehicle context: ${payload.vehicleContext || leadMeta.vehicle}` : '';
  const customerCtx = leadMeta.customer_name ? `\nCustomer: ${leadMeta.customer_name}` : '';

  const cmdMessage = `[COMMAND MODE — Answer this question or execute this request for an automotive sales rep.]

Rep: ${repName}
Dealership: ${dealership}
${contextBlock}${customerCtx}${vehicleCtx}

Question/Request: "${payload.command}"

Provide a direct, actionable answer. Keep it concise (2-4 sentences). If the question is about a specific process, give step-by-step instructions. If it's a knowledge question, answer factually.`;

  const apiBase = await getResolvedApiUrl();
  const result = await generateViaProxy(
    dealerToken,
    cmdMessage,
    'command',
    { ...leadMeta, rep_name: repName, workflow_type: 'ask_anything', stream_target: 'command' },
    repAuthToken,
    undefined,
    apiBase
  );
  await logToolEvent('ask_anything', payload.command || '', result.text, {
    ...leadMeta,
    parsed_vehicle: payload.vehicleContext || leadMeta.vehicle || null,
    current_url: payload.currentUrl || null,
  });
  return { parsed: { action: 'answer', content: result.text }, text: result.text };
}

// ===== CONTEXT REPLY (screenshot vision) =====
async function handleContextReply(payload: {
  image: string;
  direction: string;
  page_text?: string;
  platform?: string;
  image_meta?: any;
  leadContext?: Record<string, any>;
}) {
  const settings = await browser.storage.local.get(['rep_name', 'rep_auth_token', 'brevmont_rep_auth_token']);
  const dealerToken = await resolveDealerToken();
  if (!dealerToken) throw new Error('No license key found.');

  // Rep-token resolution — mirrors handleGenerate.
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

  if (payload.image_meta?.fallback && payload.page_text) {
    const apiBase = await getResolvedApiUrl();
    const { repName, dealership, contextBlock } = await buildRepContext();
    const leadMeta = toolLeadMetadata(payload, payload.platform);
    const prompt = `[SCREENSHOT REPLY FALLBACK — visible page text captured, screenshot permission unavailable]

Rep: ${repName}
Dealership: ${dealership}
${contextBlock}
Platform: ${payload.platform || 'unknown'}
Direction from rep: "${payload.direction || 'Write a natural reply based on this conversation.'}"

Visible page text:
${String(payload.page_text || '').slice(0, 5000)}

Write one concise, natural customer reply. If dollar amounts, payment terms, vehicle, credit score, down payment, or fees are visible, reference the exact details. Do not mention that a screenshot failed.`;

    const result = await generateViaProxy(
      dealerToken,
      prompt,
      'screenshot',
      { ...leadMeta, rep_name: repName, workflow_type: 'context_reply', stream_target: 'context_reply' },
      repAuthToken,
      undefined,
      apiBase
    );
    await logToolEvent('screenshot_reply', payload.direction || '', result.text, leadMeta);
    return { reply: result.text, fallback: true };
  }

  let resp: Response;
  try {
    const apiBase = await getResolvedApiUrl();
    resp = await signedFetch(`${apiBase}/api/context-reply`, {
      dealer_token: dealerToken,
      rep_name: (settings.rep_name as string | undefined) || null,
      image: payload.image,
      direction: payload.direction || 'Write a natural reply based on the screenshot.',
      page_text: payload.page_text || '',
      platform: payload.platform || 'unknown',
      image_meta: payload.image_meta || null,
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
  const sectionText = data.sections && typeof data.sections === 'object'
    ? [data.sections.text, data.sections.email, data.sections.crm_note, data.sections.message]
        .filter(Boolean)
        .join('\n\n')
    : '';
  const text = data.reply
    || data.text
    || sectionText
    || data.output
    || data.content?.[0]?.text
    || '';
  if (!text) throw new Error('Empty response. Try again.');
  await logToolEvent('screenshot_reply', payload.direction || '', text, toolLeadMetadata(payload, payload.platform));
  return { reply: text };
}

// ===== VOICE REPLY (transcription → generate) =====
async function handleVoiceReply(payload: { transcription: string }) {
  const settings = await browser.storage.local.get(['rep_auth_token']);
  const dealerToken = await resolveDealerToken();
  const { repName, dealership, contextBlock } = await buildRepContext();
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

  const voiceVehicle = parseLooseLeadText(payload.transcription).vehicle_interest || null;
  const vehicleInstruction = voiceVehicle
    ? `\nVehicle mentioned by rep: ${voiceVehicle}\nAlways reference this vehicle in the generated follow-up.`
    : '';
  const voiceMessage = `[Voice dictation — clean up filler words and extract intent]\nRep said: "${payload.transcription}"${vehicleInstruction}\nGenerate a professional text message reply based on their intent. Keep it 2-3 sentences max.`;

  const metadata = {
    rep_name: repName,
    workflow_type: 'voice_reply',
    customer_name: null,
    vehicle: voiceVehicle
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
    const settings = await browser.storage.local.get(['dealer_token', 'rep_name', 'dealership']);
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
  return getLegacyFeatureFlagsForTier(tier);
}

async function requireFeature(feature: string, label: string): Promise<void> {
  const data = await browser.storage.local.get(['brevmont_tier']);
  const tier = String(data.brevmont_tier || 'free');
  const features = getTierFeatures(tier) as Record<string, boolean>;
  if (tier === 'free' || features[feature] !== true) {
    throw new Error(`${label} is available on paid Brevmont plans.`);
  }
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
    msg += 'Generate ALL THREE follow-ups. You MUST produce all three labeled sections:\n';
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
  const textMatch = text.match(/(?:^|\n)TEXT(?:\s*MESSAGE)?[:\s\-]*\n([\s\S]*?)(?=\n(?:EMAIL|CRM)|$)/i);
  const emailMatch = text.match(/(?:^|\n)EMAIL(?:\s*REPLY)?[:\s\-]*\n([\s\S]*?)(?=\n(?:TEXT|CRM)|$)/i);
  const crmMatch = text.match(/(?:^|\n)CRM(?: NOTE)?[:\s\-]*\n([\s\S]*)$/i);

  return {
    text: textMatch?.[1]?.trim() || '',
    email: emailMatch?.[1]?.trim() || '',
    crm: crmMatch?.[1]?.trim() || '',
    raw: text,
  };
}
