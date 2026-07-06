/**
 * Overdrive thread state machine — client-side.
 *
 * Persists thread state in chrome.storage.local so cross-restart
 * state survives, but the server (via /api/overdrive/thread/:key) is
 * the source of truth. Client cache is a hot-path optimization only.
 *
 * Stages:
 *   inquiry           first contact
 *   qualifying        availability confirmed, gathering intent
 *   objection         price / distance / spouse / "just looking" / etc.
 *   appointment_drive actively proposing times
 *   appointment_set   GOAL — customer committed to day + time
 *   escalated         handed to rep
 *   dead              explicit no / ghosted past threshold
 *
 * Transitions are advisory from the client — the server's reply engine
 * (Commit 9) actually decides the next stage from the model output. The
 * client just tracks + persists what the server says.
 */

import type { OverdriveStage } from './types';

const STORAGE_KEY_PREFIX = 'overdrive_thread:';

export interface LocalThreadState {
  conversation_key: string;
  stage: OverdriveStage;
  last_inbound_hash: string | null;
  last_inbound_at: number | null;
  last_reply_at: number | null;
  last_reply_text_norm: string | null;
  replies_today: number;
  replies_today_reset_ymd: string; // YYYY-MM-DD, rep local
  paused: boolean;
  paused_reason: string | null;
  escalated_at: number | null;
  escalation_reason: string | null;
  ai_question_count: number; // for two-strike escalation on "are you a bot?"
  listing_title?: string;
  listing_url?: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  updated_at: number;
}

const TERMINAL_STAGES: OverdriveStage[] = ['escalated', 'dead'];

/** UTC or timezone-aware "today" key. Uses local date to align with
 *  active-hours checks. */
function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function storageKey(conversation_key: string): string {
  return `${STORAGE_KEY_PREFIX}${conversation_key}`;
}

export async function readThreadState(conversation_key: string): Promise<LocalThreadState | null> {
  try {
    const key = storageKey(conversation_key);
    const data = await chrome.storage.local.get([key]);
    const state = (data?.[key] as LocalThreadState | undefined) || null;
    if (!state) return null;
    if (typeof state.last_reply_text_norm === 'undefined') state.last_reply_text_norm = null;
    // Rotate replies_today counter if we crossed a day boundary.
    if (state.replies_today_reset_ymd !== todayYmd()) {
      state.replies_today = 0;
      state.replies_today_reset_ymd = todayYmd();
      await writeThreadState(state);
    }
    return state;
  } catch {
    return null;
  }
}

export async function writeThreadState(state: LocalThreadState): Promise<void> {
  try {
    state.updated_at = Date.now();
    await chrome.storage.local.set({ [storageKey(state.conversation_key)]: state });
  } catch {
    /* storage full or extension unloading — non-fatal */
  }
}

export function emptyState(conversation_key: string): LocalThreadState {
  return {
    conversation_key,
    stage: 'inquiry',
    last_inbound_hash: null,
    last_inbound_at: null,
    last_reply_at: null,
    last_reply_text_norm: null,
    replies_today: 0,
    replies_today_reset_ymd: todayYmd(),
    paused: false,
    paused_reason: null,
    escalated_at: null,
    escalation_reason: null,
    ai_question_count: 0,
    updated_at: Date.now(),
  };
}

export function isTerminal(stage: OverdriveStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/**
 * Decide whether to fire an autonomous reply for this thread right now.
 * Returns a structured result so the caller (background worker) can log
 * WHY we skipped. Server does the same check server-side, but the
 * client short-circuits obvious no-gos to save an API call.
 */
export interface ShouldReplyInput {
  state: LocalThreadState;
  last_inbound_hash: string;
  last_inbound_text?: string;
  now: number;
  caps: {
    per_thread_per_minute: number;
    per_thread_per_day: number;
    per_rep_per_day: number;
  };
  rep_replies_today: number; // aggregated across all threads for this rep
  rep_currently_typing_in_thread: boolean;
}

export interface ShouldReplyResult {
  should: boolean;
  reason: string;
}

export function normalizeOverdriveEchoText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}'"$%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldReply(input: ShouldReplyInput): ShouldReplyResult {
  const { state, last_inbound_hash, last_inbound_text, now, caps, rep_replies_today, rep_currently_typing_in_thread } = input;

  if (isTerminal(state.stage)) {
    return { should: false, reason: `terminal_stage:${state.stage}` };
  }
  if (state.paused) {
    return { should: false, reason: `thread_paused:${state.paused_reason || 'unknown'}` };
  }
  if (rep_currently_typing_in_thread) {
    return { should: false, reason: 'rep_actively_typing' };
  }
  if (state.last_inbound_hash === last_inbound_hash && state.last_reply_at) {
    return { should: false, reason: 'duplicate_inbound_hash' };
  }
  const inboundNorm = normalizeOverdriveEchoText(last_inbound_text);
  if (inboundNorm && state.last_reply_text_norm && inboundNorm === state.last_reply_text_norm) {
    return { should: false, reason: 'own_reply_echo' };
  }
  // Do not rate-limit fresh inbound turns by wall clock. Marketplace
  // customers often rapid-fire follow-ups; idempotency, same-turn
  // hashes, echo detection, and the server send budget are the safety
  // rails. A clock-only gate makes a good active exchange look broken.
  // Cap: per_thread_per_day
  if (state.replies_today >= caps.per_thread_per_day) {
    return { should: false, reason: 'thread_daily_cap' };
  }
  // Cap: per_rep_per_day
  if (rep_replies_today >= caps.per_rep_per_day) {
    return { should: false, reason: 'rep_daily_cap' };
  }
  return { should: true, reason: 'ok' };
}

/**
 * Update local state after a reply attempt. Called by the background
 * worker after /api/overdrive/reply resolves (or a send verify fails).
 */
export async function recordReplyOutcome(
  conversation_key: string,
  patch: {
    stage?: OverdriveStage;
    last_inbound_hash?: string;
    escalated_reason?: string | null;
    ai_question_triggered?: boolean;
    verified?: boolean;
    reply_text?: string | null;
    listing_title?: string;
    vehicle_year?: number;
    vehicle_make?: string;
    vehicle_model?: string;
  }
): Promise<LocalThreadState> {
  const existing = (await readThreadState(conversation_key)) || emptyState(conversation_key);
  const now = Date.now();
  if (patch.stage) existing.stage = patch.stage;
  if (patch.last_inbound_hash) existing.last_inbound_hash = patch.last_inbound_hash;
  if (patch.escalated_reason) {
    existing.escalation_reason = patch.escalated_reason;
    existing.escalated_at = now;
    existing.stage = 'escalated';
  }
  if (patch.ai_question_triggered) {
    existing.ai_question_count += 1;
    if (existing.ai_question_count >= 2) {
      existing.stage = 'escalated';
      existing.escalated_at = now;
      existing.escalation_reason = 'ai_question_second_ask';
    }
  }
  if (patch.reply_text) {
    existing.last_reply_text_norm = normalizeOverdriveEchoText(patch.reply_text);
  }
  if (patch.verified) {
    existing.last_reply_at = now;
    existing.replies_today += 1;
    if (existing.replies_today_reset_ymd !== todayYmd()) {
      existing.replies_today = 1;
      existing.replies_today_reset_ymd = todayYmd();
    }
  }
  if (patch.listing_title) existing.listing_title = patch.listing_title;
  if (typeof patch.vehicle_year === 'number') existing.vehicle_year = patch.vehicle_year;
  if (patch.vehicle_make) existing.vehicle_make = patch.vehicle_make;
  if (patch.vehicle_model) existing.vehicle_model = patch.vehicle_model;
  await writeThreadState(existing);
  return existing;
}
