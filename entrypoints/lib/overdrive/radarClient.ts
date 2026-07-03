/**
 * Lead Radar API client — passive capture path.
 *
 * Radar runs BEFORE (and independent of) the Overdrive reply flow.
 * Every detection signal that scrapes a Marketplace-origin thread
 * calls into POST /api/v1/radar/capture — regardless of whether
 * Overdrive is enabled for this rep/dealership.
 *
 * Idempotency is server-side: captured_leads_conversation_key_uk
 * (migration 304) + last_inbound_hash short-circuit. Client just fires.
 *
 * Failure modes: fail-silent. Radar is best-effort — a network hiccup
 * shouldn't spam the user or break the Overdrive path that follows.
 */

import { signedFetch, signedGet } from '../../../lib/authSigning';

export interface RadarCaptureBody {
  conversation_key: string;
  last_inbound_hash?: string | null;
  last_inbound_text?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  listing?: {
    title?: string | null;
    url?: string | null;
    vehicle_year?: number | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
  };
  source_platform?: 'facebook_marketplace' | 'facebook_messenger' | string;
  sweep_source?: 'live' | 'catchup_sweep';
}

export interface RadarCaptureResult {
  ok: boolean;
  mode?: 'created' | 'updated' | 'noop';
  captured_lead_id?: string;
  reason?: string;
}

async function getApiBase(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['api_base_url']);
    return (cfg?.api_base_url as string | undefined) || 'https://api.brevmont.com';
  } catch { return 'https://api.brevmont.com'; }
}

async function radarFetch<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const base = await getApiBase();
    const method = String(init.method || 'GET').toUpperCase();
    const headers = init.headers as Record<string, string> | undefined;
    const requestBody = typeof init.body === 'string'
      ? JSON.parse(init.body || '{}')
      : (init.body || {});
    const url = `${base}${path}`;
    const res = method === 'GET'
      ? await signedGet(url, headers)
      : await signedFetch(url, requestBody, headers);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const responseBody = isJson ? await res.json().catch(() => ({})) : (await res.text().catch(() => ''));
    if (!res.ok) return null;
    return responseBody as T;
  } catch { return null; }
}

export async function radarCapture(body: RadarCaptureBody): Promise<RadarCaptureResult> {
  const result = await radarFetch<RadarCaptureResult>('/api/v1/radar/capture', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result || { ok: false, reason: 'radar_network_error' };
}

export async function radarSweepDone(counts: Record<string, number>): Promise<void> {
  await radarFetch<void>('/api/v1/radar/sweep-done', {
    method: 'POST',
    body: JSON.stringify({ counts }),
  });
}

export interface RadarStatus {
  enabled: boolean;
  reason_if_disabled: string | null;
  count_today: number;
  last_capture_at: string | null;
}

export async function radarStatus(): Promise<RadarStatus | null> {
  return radarFetch<RadarStatus>('/api/v1/radar/status', { method: 'GET' });
}

export async function radarToggle(enabled: boolean): Promise<boolean> {
  const r = await radarFetch<{ ok: boolean }>('/api/v1/radar/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  return !!r?.ok;
}
