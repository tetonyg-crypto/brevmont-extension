/**
 * Tool: honestEvents.ts
 * Purpose: Browser-observable event logging client for Brevmont.
 *          Posts to /api/v1/events on the API. Only fires for events the
 *          extension can actually observe — never sends, deliveries, opens,
 *          or replies. See routes/events-v2.js for the server-side allowlist.
 * Inputs: event_type + browser-observed metadata
 * Outputs: Best-effort delivery; never throws into the main flow
 * Dependencies: chrome.storage.local
 * Last Updated: 2026-05-06
 */

const API_BASE = 'https://api.brevmont.com';

export type HonestEventType =
  | 'generation.created'
  | 'generation.copied'
  | 'generation.pasted'
  | 'generation.send_clicked'
  | 'generation.regenerated'
  | 'generation.discarded';

export type HonestPlatform = 'gmail' | 'messenger' | 'linkedin' | 'vinsolutions' | 'unknown';
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
  try {
    const r = await chrome.storage.local.get(['rep_auth_token', 'rep_token', 'dealer_token']);
    return r.rep_auth_token || r.rep_token || r.dealer_token || null;
  } catch {
    return null;
  }
}

const queue: HonestEventPayload[] = [];
let flushing = false;

async function flushQueue() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const token = await getRepToken();
    if (!token) {
      flushing = false;
      return;
    }
    const batch = queue.splice(0, queue.length);
    for (const payload of batch) {
      try {
        const res = await fetch(`${API_BASE}/api/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Rep-Token': token,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok && res.status >= 500) {
          // requeue transient failures
          queue.push(payload);
        }
      } catch {
        // network failure — requeue and stop draining
        queue.push(payload);
        break;
      }
    }
  } catch {
    // never throw
  } finally {
    flushing = false;
  }
}

try {
  setInterval(() => {
    flushQueue().catch(() => {});
  }, 5000);
} catch {}

export function logEvent(payload: Omit<HonestEventPayload, 'client_ts'>): void {
  try {
    queue.push({ ...payload, client_ts: new Date().toISOString() });
    flushQueue().catch(() => {});
  } catch {
    // never throw into main flow
  }
}

export function detectPlatform(): HonestPlatform {
  try {
    const h = (typeof window !== 'undefined' && window.location ? window.location.hostname : '') || '';
    if (h.includes('mail.google.com')) return 'gmail';
    if (h.includes('messenger.com') || h.includes('facebook.com')) return 'messenger';
    if (h.includes('linkedin.com')) return 'linkedin';
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
