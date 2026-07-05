/**
 * Overdrive API client — thin wrapper around fetch that resolves the
 * rep_auth_token from extension storage and hits the /api/overdrive/*
 * endpoints. Called from the sidepanel and background worker.
 */

import type { FacebookProfileScrape } from './linkFacebook';
import type { OverdriveThreadContext } from './types';
import { signedFetch, signedGet, signedPatch } from '../../../lib/authSigning';

async function getApiBase(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['api_base_url']);
    return cfg?.api_base_url || 'https://api.brevmont.com';
  } catch {
    return 'https://api.brevmont.com';
  }
}

async function overdriveFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await getApiBase();
  const method = String(init.method || 'GET').toUpperCase();
  const headers = init.headers as Record<string, string> | undefined;
  const requestBody = typeof init.body === 'string'
    ? JSON.parse(init.body || '{}')
    : (init.body || {});
  const url = `${base}${path}`;
  const res = method === 'GET'
    ? await signedGet(url, headers)
    : method === 'PATCH'
      ? await signedPatch(url, requestBody, headers)
      : await signedFetch(url, requestBody, headers);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const responseBody = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = new Error(
      typeof responseBody === 'object' && responseBody?.error ? String(responseBody.error) : `overdrive_api_${res.status}`
    );
    (err as any).status = res.status;
    (err as any).body = responseBody;
    throw err;
  }
  return responseBody as T;
}

export interface OverdriveSettingsResponse {
  label: string;
  dealership_enabled: boolean;
  dealership_disabled?: boolean;
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
  paused_by: 'rep' | 'gm' | 'takeover' | 'escalation' | null;
  pause_reason: string | null;
  resumed_at: string | null;
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

export interface OverdriveThreadDecision {
  id: string | null;
  event_type: string | null;
  server_ts: string | null;
  decision: string;
  stop_reason: string;
  plain_text: string;
  message_snippet: string | null;
  classification: string | null;
  draft: string | null;
  recovery: string[];
  metadata?: {
    source?: string | null;
    details?: unknown;
    pending_window_seconds?: number | null;
    idempotency_key?: string | null;
  };
}

export interface OverdriveThreadDecisionResponse {
  conversation_key: string;
  latest: OverdriveThreadDecision | null;
  decisions: OverdriveThreadDecision[];
  thread: OverdriveThreadState | null;
  plain_word_map_version: string;
}

export async function getThreadDecision(conversation_key: string): Promise<OverdriveThreadDecisionResponse> {
  return overdriveFetch<OverdriveThreadDecisionResponse>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}/decision`
  );
}

// 1.16.47: pause requires paused_by so the server records origin
// (rep manual, GM dashboard, takeover, escalation). Default 'rep'
// matches the pre-1.16.47 behavior for callers that don't specify.
export async function pauseThread(
  conversation_key: string,
  opts?: { reason?: string; paused_by?: 'rep' | 'gm' | 'takeover' | 'escalation' },
): Promise<{ thread: OverdriveThreadState }> {
  return overdriveFetch<{ thread: OverdriveThreadState }>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}/pause`,
    {
      method: 'POST',
      body: JSON.stringify({
        reason: opts?.reason || 'rep_paused',
        paused_by: opts?.paused_by || 'rep',
      }),
    }
  );
}

// 1.16.47: state-poll for cross-surface sync. Client polls every 8s;
// when seq changes, refetch settings + thread state. Cheap.
export async function getOverdriveStateSeq(): Promise<{ seq: string }> {
  try {
    return await overdriveFetch<{ seq: string }>('/api/overdrive/state');
  } catch { return { seq: '' }; }
}

export async function resumeThread(conversation_key: string): Promise<{ thread: OverdriveThreadState | null }> {
  return overdriveFetch<{ thread: OverdriveThreadState | null }>(
    `/api/overdrive/thread/${encodeURIComponent(conversation_key)}/resume`,
    { method: 'POST' }
  );
}

export interface OverdriveReplyResponse {
  idempotency_key: string;
  turn_id?: string;
  send_token?: string;
  reply_text: string;
  next_stage: string;
  escalate: boolean;
  escalation_reason: string | null;
  ai_question_triggered: boolean;
  photo_data_url: string | null;
  pending_window_seconds?: number;
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

// ─────────────────────────────────────────────────────────────────
// Migration 310: send-confirm write-through
// ─────────────────────────────────────────────────────────────────
// The extension MUST call confirmOverdriveSend after every
// overdriveSend() attempt so the server can write the terminal
// event (overdrive.reply_sent|appointment_set|photo_sent) instead
// of trusting a pre-send optimistic write. On DOM verify failure,
// pass verified: false — server writes overdrive.send_unverified.
export interface OverdriveSendConfirmPayload {
  conversation_key: string;
  idempotency_key: string;
  turn_id?: string;
  send_token?: string;
  verified: boolean;
  method: 'enter_key' | 'button_click' | 'react_fiber' | 'not_attempted' | string;
  latency_ms: number;
  attempts: Array<{ method: string; ok: boolean; error?: string }>;
  ai_output: string;
  next_stage: string;
  ai_question_triggered: boolean;
  attach_ok: boolean;
  attach_method: string | null;
}

export async function confirmOverdriveSend(
  payload: OverdriveSendConfirmPayload,
): Promise<{ ok: boolean; event_type: string }> {
  return overdriveFetch<{ ok: boolean; event_type: string }>(
    '/api/overdrive/send-confirm',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

// Hop 1 receipts — fire-and-forget from the detector layer BEFORE
// qualification / caps / send. Server writes overdrive.detected.
export interface OverdriveDetectionPayload {
  conversation_key: string;
  inbound_hash: string;
  source: 'mutation_observer' | 'title_watch' | 'alarm_sweep' | 'manual' | string;
}

export async function reportOverdriveDetection(
  payload: OverdriveDetectionPayload,
): Promise<{ ok: boolean }> {
  return overdriveFetch<{ ok: boolean }>('/api/overdrive/detected', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Production-visible stop receipts. The detector can fire before local
// go-light/cap/duplicate checks, so every client-side pre-reply stop must
// write a server row or the timeline becomes "detected then silence".
export interface OverdriveBlockedPayload {
  conversation_key: string;
  inbound_hash?: string | null;
  source: 'eligibility_gate' | 'orchestrator_skip' | 'orchestrator_exception' | string;
  reason: string;
  details?: Record<string, unknown>;
}

export async function reportOverdriveBlocked(
  payload: OverdriveBlockedPayload,
): Promise<{ ok: boolean }> {
  return overdriveFetch<{ ok: boolean }>('/api/overdrive/blocked', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
