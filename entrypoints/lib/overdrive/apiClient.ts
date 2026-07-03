/**
 * Overdrive API client — thin wrapper around fetch that resolves the
 * rep_auth_token from extension storage and hits the /api/overdrive/*
 * endpoints. Called from the sidepanel and background worker.
 */

import type { FacebookProfileScrape } from './linkFacebook';
import type { OverdriveThreadContext } from './types';

async function getRepAuthToken(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(['rep_auth_token', 'dealer_token']);
    return stored?.rep_auth_token || stored?.dealer_token || null;
  } catch {
    return null;
  }
}

async function getApiBase(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['api_base_url']);
    return cfg?.api_base_url || 'https://api.brevmont.com';
  } catch {
    return 'https://api.brevmont.com';
  }
}

async function overdriveFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [token, base] = await Promise.all([getRepAuthToken(), getApiBase()]);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['X-Rep-Token'] = token;
    if (!headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = new Error(
      typeof body === 'object' && body?.error ? String(body.error) : `overdrive_api_${res.status}`
    );
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  return body as T;
}

export interface OverdriveSettingsResponse {
  label: string;
  dealership_enabled: boolean;
  dealership_daily_cap: number;
  settings: {
    enabled: boolean;
    enabled_at: string | null;
    disabled_at: string | null;
    active_hours_start: number;
    active_hours_end: number;
    timezone: string;
    keep_facebook_open: boolean;
    ai_question_response: string | null;
    cap_per_thread_per_minute: number;
    cap_per_thread_per_day: number;
    cap_per_rep_per_day: number;
  } | null;
  linked: {
    facebook: boolean;
    facebook_profile_name: string | null;
    facebook_profile_url: string | null;
    facebook_linked_at: string | null;
    rep_photo_url: string | null;
    disclosure_ack_at: string | null;
  };
  defaults: {
    active_hours_start: number;
    active_hours_end: number;
    timezone: string;
    ai_question_response: string;
    cap_per_thread_per_minute: number;
    cap_per_thread_per_day: number;
    cap_per_rep_per_day: number;
  };
}

export async function getOverdriveSettings(): Promise<OverdriveSettingsResponse> {
  return overdriveFetch<OverdriveSettingsResponse>('/api/overdrive/settings');
}

export async function patchOverdriveSettings(patch: Partial<OverdriveSettingsResponse['settings'] & { enabled: boolean }>): Promise<OverdriveSettingsResponse> {
  return overdriveFetch<OverdriveSettingsResponse>('/api/overdrive/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function postLinkFacebook(scrape: FacebookProfileScrape): Promise<{ ok: boolean; linked_at: string; profile_name: string }> {
  return overdriveFetch('/api/overdrive/link-facebook', {
    method: 'POST',
    body: JSON.stringify({
      profile_name: scrape.profile_name,
      profile_url: scrape.profile_url,
    }),
  });
}

export async function postUnlinkFacebook(): Promise<{ ok: boolean }> {
  return overdriveFetch('/api/overdrive/unlink-facebook', { method: 'POST' });
}

export async function postDisclosureAck(version = '2026-07-02.v1'): Promise<{ ok: boolean; acknowledged_at: string; version: string }> {
  return overdriveFetch('/api/overdrive/disclosure/ack', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function postRepPhoto(dataUrl: string): Promise<{ ok: boolean; bytes: number }> {
  return overdriveFetch('/api/overdrive/photo', {
    method: 'POST',
    body: JSON.stringify({ data_url: dataUrl }),
  });
}

export interface OverdriveThreadState {
  id: string;
  conversation_key: string;
  stage: string;
  paused_at: string | null;
  last_inbound_hash: string | null;
  last_inbound_at: string | null;
  last_reply_at: string | null;
  replies_total: number;
  replies_this_thread_day: number;
  escalated_at: string | null;
  escalation_reason: string | null;
  listing_url: string | null;
  listing_title: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
}

export async function getThreadState(conversation_key: string): Promise<{ thread: OverdriveThreadState | null }> {
  return overdriveFetch<{ thread: OverdriveThreadState | null }>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}`
  );
}

export async function pauseThread(conversation_key: string, reason?: string): Promise<{ thread: OverdriveThreadState }> {
  return overdriveFetch<{ thread: OverdriveThreadState }>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}/pause`,
    { method: 'POST', body: JSON.stringify({ reason: reason || 'rep_paused' }) }
  );
}

export async function resumeThread(conversation_key: string): Promise<{ thread: OverdriveThreadState | null }> {
  return overdriveFetch<{ thread: OverdriveThreadState | null }>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}/resume`,
    { method: 'POST' }
  );
}

export interface OverdriveReplyResponse {
  idempotency_key: string;
  reply_text: string;
  next_stage: string;
  escalate: boolean;
  escalation_reason: string | null;
  ai_question_triggered: boolean;
  photo_data_url: string | null;
  server_ts: string;
}

export async function requestOverdriveReply(
  ctx: OverdriveThreadContext
): Promise<OverdriveReplyResponse> {
  return overdriveFetch<OverdriveReplyResponse>('/api/overdrive/reply', {
    method: 'POST',
    body: JSON.stringify(ctx),
    // Server generates the deterministic Idempotency-Key from the body;
    // we could also generate it client-side and pass in via header, but
    // keeping the source of truth server-side avoids drift.
  });
}
