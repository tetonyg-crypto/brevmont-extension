/**
 * Tool: honestEvents.ts
 * Purpose: Browser-observable event logging client for Brevmont. Posts to
 *          /api/v1/events/batch on the API. Only fires for events the
 *          extension can actually observe — never sends, deliveries, opens,
 *          or replies. See routes/events-v2.js for the server-side allowlist.
 *
 *          Phase 2 (2026-05-06) durability rewrite:
 *            - queue is persisted in chrome.storage.local (key: telemetry_queue_v2)
 *              so a service-worker respawn or tab close doesn't lose pending
 *              events
 *            - queue is FIFO-capped at 100 (drops oldest first)
 *            - flush is driven by chrome.alarms (every 60s) — survives MV3
 *              service-worker idle/respawn cycles, unlike the prior
 *              setInterval(...) which died on first SW idle
 *            - flush sends one batch POST to /api/v1/events/batch instead of
 *              N single POSTs, eliminating the per-tab dupe-flush race
 *          Audit E-3 (P1) fixes both the durability gap and the multi-tab
 *          duplicate-send issue.
 *
 * Inputs: event_type + browser-observed metadata
 * Outputs: Best-effort delivery; never throws into the main flow
 * Dependencies: chrome.storage.local, chrome.alarms (background SW only)
 * Last Updated: 2026-05-06
 */

import { signedFetch } from '../../lib/authSigning';

const API_BASE = 'https://api.brevmont.com';
const QUEUE_KEY = 'telemetry_queue_v2';
const MAX_QUEUE_SIZE = 100;
const BATCH_SIZE = 50;

export type HonestEventType =
  | 'generation.created'
  | 'generation.copied'
  | 'generation.pasted'
  | 'generation.send_clicked'
  | 'generation.regenerated'
  | 'generation.discarded';

export type HonestPlatform =
  | 'gmail'
  | 'outlook'
  | 'messenger'
  | 'facebook'
  | 'linkedin'
  | 'vinsolutions'
  | 'instagram'
  | 'whatsapp'
  | 'google-messages'
  | 'cargurus'
  | 'carsdotcom'
  | 'autotrader'
  | 'dealersocket'
  | 'elead'
  | 'unknown';
export type HonestOutputType = 'text' | 'email' | 'crm_note';

export interface HonestEventPayload {
  event_type: HonestEventType;
  platform: HonestPlatform;
  output_type?: HonestOutputType;
  generation_id?: string;
  customer_context?: { name?: string | null; vehicle?: string | null };
  action_metadata?: Record<string, any>;
  output_length?: number;
  client_ts: string;
}

async function getRepToken(): Promise<string | null> {
  // Check every storage slot the rest of the extension uses. Background.ts
  // writes both rep_auth_token and brevmont_rep_auth_token on activation;
  // some legacy paths only land in chrome.storage.sync. Returning null
  // here drops events silently, so we exhaust every key before giving up.
  const KEYS = ['rep_auth_token', 'brevmont_rep_auth_token', 'rep_token', 'dealer_token'];
  try {
    const local = await chrome.storage.local.get(KEYS);
    for (const k of KEYS) {
      const v = (local as any)[k];
      if (typeof v === 'string' && v) return v;
    }
  } catch {}
  try {
    const sync = await chrome.storage.sync.get(KEYS);
    for (const k of KEYS) {
      const v = (sync as any)[k];
      if (typeof v === 'string' && v) return v;
    }
  } catch {}
  return null;
}

function getExtVersion(): string {
  try {
    return chrome?.runtime?.getManifest?.()?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readQueue(): Promise<HonestEventPayload[]> {
  try {
    const result = await chrome.storage.local.get(QUEUE_KEY);
    const arr = (result as any)[QUEUE_KEY];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: HonestEventPayload[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  } catch {}
}

async function enqueue(payload: HonestEventPayload): Promise<void> {
  const queue = await readQueue();
  queue.push(payload);
  // FIFO cap — drop oldest if over MAX. The cap is per-extension-install,
  // not per-tab, because storage.local is shared across tabs. Multi-tab
  // floors with 50 reps would still fit comfortably under 100.
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }
  await writeQueue(queue);
}

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) {
      flushing = false;
      return;
    }
    const token = await getRepToken();
    if (!token) {
      // Diagnostic so the founder can see in DevTools why events aren't landing.
      try { console.warn('[brevmont:honest] no rep token in storage — events held in queue:', queue.length); } catch {}
      flushing = false;
      return;
    }

    // Send in batches of BATCH_SIZE so a 100-event flush after an outage
    // doesn't hit any per-request body limits. POST one batch; on success
    // remove those rows from the persisted queue and continue. On 5xx /
    // network error, leave queue intact and bail (next alarm will retry).
    let remaining = queue;
    while (remaining.length > 0) {
      const batch = remaining.slice(0, BATCH_SIZE);
      let ok = false;
      try {
        const res = await signedFetch(
          `${API_BASE}/api/v1/events/batch`,
          { events: batch },
          { 'X-Extension-Version': getExtVersion() },
        );
        if (res.ok) {
          ok = true;
          try { console.info('[brevmont:honest] batch POST 201', batch.length, 'events'); } catch {}
        } else if (res.status >= 400 && res.status < 500) {
          // 4xx (validation failure) — drop the batch so we don't loop on it.
          // The server returns the offending index for an invalid event.
          let body = '';
          try { body = (await res.text()).slice(0, 240); } catch {}
          try { console.warn('[brevmont:honest] batch POST', res.status, 'dropping batch:', body); } catch {}
          ok = true; // treat as "removed from queue" so we don't retry forever
        } else {
          // 5xx — leave queue intact, retry next alarm.
          try { console.warn('[brevmont:honest] batch POST', res.status, '— leaving queue for retry'); } catch {}
        }
      } catch (err) {
        try { console.warn('[brevmont:honest] batch fetch threw:', (err as any)?.message || err); } catch {}
      }
      if (!ok) break;
      remaining = remaining.slice(batch.length);
    }
    // Persist the remaining queue (whatever wasn't successfully drained).
    await writeQueue(remaining);
  } catch {
    // never throw
  } finally {
    flushing = false;
  }
}

// chrome.alarms-driven drain. Survives MV3 service-worker respawn (unlike
// setInterval). 1-minute period balances delivery latency with battery /
// network use. The alarm is registered in background.ts onInstalled +
// onStartup; this module doesn't register it directly because content.ts
// imports this file too and content scripts can't create alarms.
//
// Belt and suspenders: when running in the SW context AND chrome.alarms
// is reachable, ensure the alarm exists. The check is no-op-safe in
// content-script context (chrome.alarms is undefined there).
try {
  if (typeof chrome !== 'undefined' && (chrome as any).alarms && typeof (chrome as any).alarms.create === 'function') {
    (chrome as any).alarms.create('telemetry_drain', { periodInMinutes: 1 });
  }
} catch {}

// Debug helper — exposed on the global so the founder can probe state from
// the page console even though chrome.storage isn't reachable from page context.
//   In DevTools on Gmail: window.__brevmontHonestDebug?.()
export async function honestDebug(): Promise<{ queue_size: number; has_token: boolean; token_prefix: string | null }> {
  const queue = await readQueue();
  const token = await getRepToken();
  return {
    queue_size: queue.length,
    has_token: !!token,
    token_prefix: token ? token.slice(0, 12) : null,
  };
}

export function logEvent(payload: Omit<HonestEventPayload, 'client_ts'>): void {
  try {
    // Auto-stamp the extension version into action_metadata so any event
    // landing in event_log_v2 carries proof of which build emitted it.
    const stamped: HonestEventPayload = {
      ...payload,
      client_ts: new Date().toISOString(),
      action_metadata: {
        ...(payload.action_metadata || {}),
        ext_version: getExtVersion(),
      },
    };
    // Persist + opportunistic flush. Both are async + safe-to-fail.
    enqueue(stamped).catch(() => {});
    flushQueue().catch(() => {});
  } catch {
    // never throw into main flow
  }
}

export function detectPlatform(): HonestPlatform {
  try {
    const h = (typeof window !== 'undefined' && window.location ? window.location.hostname : '') || '';
    if (h.includes('mail.google.com')) return 'gmail';
    if (h.includes('outlook.live.com') || h.includes('outlook.office.com') || h.includes('outlook.office365.com')) return 'outlook';
    if (h.includes('messenger.com') || h.includes('facebook.com')) return 'messenger';
    if (h.includes('linkedin.com')) return 'linkedin';
    if (h.includes('instagram.com')) return 'instagram';
    if (h.includes('web.whatsapp.com')) return 'whatsapp';
    if (h.includes('messages.google.com')) return 'google-messages';
    if (h.includes('cargurus.com')) return 'cargurus';
    if (h.includes('cars.com')) return 'carsdotcom';
    if (h.includes('autotrader.com')) return 'autotrader';
    if (h.includes('dealersocket.com')) return 'dealersocket';
    if (h.includes('elead-crm.com') || h.includes('eleadcrm.com')) return 'elead';
    if (h.includes('vinsolutions.com') || h.includes('vinmanager.com')) return 'vinsolutions';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function mapOutputType(cardOutputType: string | undefined): HonestOutputType | undefined {
  if (cardOutputType === 'crm') return 'crm_note';
  if (cardOutputType === 'email') return 'email';
  if (cardOutputType === 'text') return 'text';
  return undefined;
}
