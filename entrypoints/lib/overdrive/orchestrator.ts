/**
 * Overdrive orchestrator — top-level control loop.
 *
 * Flow:
 *   1. Detector fires signal (mutation on chat list / active thread /
 *      title unread count / alarm keepalive)
 *   2. Scan the active thread for context — buyer name, listing,
 *      recent messages, last inbound text + hash
 *   3. qualifyThread() — is this Marketplace-origin?
 *   4. shouldReply() — caps, active hours, rep-typing, duplicate hash
 *   5. requestOverdriveReply() — server generates the reply, chooses
 *      next stage, decides escalation
 *   6. Wait computePreSendJitterMs()
 *   7. safeInjectText() — write reply into composer (double-inject
 *      fix already live)
 *   8. Wait computeTypingMs()
 *   9. If ai_question_triggered + photo_data_url present:
 *      overdriveAttachPhoto() first, THEN send
 *   10. overdriveSend() — DOM-verified send with fallback chain
 *   11. recordReplyOutcome() — persist local + server state
 *   12. Log to background so it can fire chrome.notifications for
 *       escalations
 *
 * The orchestrator is called from the background service worker so
 * it survives across content script reloads. The content script
 * exposes hooks it invokes via chrome.tabs.sendMessage.
 */

import { qualifyThread } from './qualification';
import type { QualificationResult } from './qualification';
import {
  emptyState,
  readThreadState,
  recordReplyOutcome,
  shouldReply,
} from './stateMachine';
import type { LocalThreadState } from './stateMachine';
import {
  buildSafetyDelay,
  inActiveHours,
  repRecentlyTyped,
} from './safetyEnvelope';
import { overdriveSend } from './overdriveSend';
import { overdriveAttachPhoto } from './overdriveAttachPhoto';
import { requestOverdriveReply } from './apiClient';
import type { OverdriveReplyResponse } from './apiClient';
import type { OverdriveStage, OverdriveThreadContext } from './types';

export interface ThreadScrape {
  conversation_key: string;
  header_text: string;
  url: string;
  recent_messages: string[]; // oldest → newest
  last_inbound_text: string;
  last_inbound_hash: string;
  rep_currently_typing: boolean;
  existing_stamp?: { source_platform?: string; vehicle_interest?: string | null } | null;
}

export interface OrchestratorSettings {
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  cap_per_thread_per_minute: number;
  cap_per_thread_per_day: number;
  cap_per_rep_per_day: number;
}

export interface OrchestratorDeps {
  /**
   * Attempt to inject the given text into the composer via the
   * content-script safeInjectText path. Returns true if injection
   * succeeded (composer wrote the text). Overdrive treats a false
   * return as a hard failure and does not attempt send.
   */
  injectText: (text: string) => Promise<boolean>;

  /**
   * Emit a structured event to the background worker for
   * event_log_v2 forwarding + chrome.notifications.
   */
  emitEvent: (event: {
    type: 'overdrive.attempted' | 'overdrive.replied' | 'overdrive.escalated' | 'overdrive.send_unverified' | 'overdrive.skipped';
    conversation_key: string;
    payload: Record<string, unknown>;
  }) => void;

  /**
   * Read aggregate replies-today count for this rep across all threads.
   * Cached in chrome.storage.local by the background worker.
   */
  getRepRepliesTodayCount: () => Promise<number>;
}

export interface OrchestratorResult {
  attempted: boolean;
  skipped_reason?: string;
  qualification?: QualificationResult;
  reply?: OverdriveReplyResponse;
  send?: { ok: boolean; method: string; verified: boolean };
  attach?: { ok: boolean; method: string };
  latency_ms: number;
}

/**
 * Main entry point — called by the background worker when a
 * detection signal fires for a thread. Returns a structured result
 * so the caller can log/telemetry appropriately.
 */
export async function orchestrateReply(
  scrape: ThreadScrape,
  settings: OrchestratorSettings,
  deps: OrchestratorDeps
): Promise<OrchestratorResult> {
  const startedAt = Date.now();

  // Step 1: qualification
  const qualification = qualifyThread({
    url: scrape.url,
    header_text: scrape.header_text,
    recent_messages: scrape.recent_messages,
    existing_stamp: scrape.existing_stamp || null,
  });
  if (!qualification.qualified) {
    deps.emitEvent({
      type: 'overdrive.skipped',
      conversation_key: scrape.conversation_key,
      payload: { reason: 'not_qualified', detail: qualification.reason },
    });
    return {
      attempted: false,
      skipped_reason: `not_qualified:${qualification.reason}`,
      qualification,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Step 2: state + shouldReply
  const state: LocalThreadState =
    (await readThreadState(scrape.conversation_key)) || emptyState(scrape.conversation_key);
  const rep_replies_today = await deps.getRepRepliesTodayCount();
  const now = Date.now();

  // rep_currently_typing_in_thread combines the scrape observation
  // (composer has non-empty text) with the recent-input rolling
  // timestamp from safetyEnvelope.markRepInput()
  const rep_typing = scrape.rep_currently_typing || repRecentlyTyped(5000);

  const decision = shouldReply({
    state,
    last_inbound_hash: scrape.last_inbound_hash,
    now,
    active_hours: { start: settings.active_hours_start, end: settings.active_hours_end },
    caps: {
      per_thread_per_minute: settings.cap_per_thread_per_minute,
      per_thread_per_day: settings.cap_per_thread_per_day,
      per_rep_per_day: settings.cap_per_rep_per_day,
    },
    rep_replies_today,
    rep_currently_typing_in_thread: rep_typing,
  });
  if (!decision.should) {
    deps.emitEvent({
      type: 'overdrive.skipped',
      conversation_key: scrape.conversation_key,
      payload: { reason: decision.reason },
    });
    return {
      attempted: false,
      skipped_reason: decision.reason,
      qualification,
      latency_ms: Date.now() - startedAt,
    };
  }

  deps.emitEvent({
    type: 'overdrive.attempted',
    conversation_key: scrape.conversation_key,
    payload: {
      stage_hint: state.stage,
      qualification_reason: qualification.reason,
    },
  });

  // Step 3: server-side reply generation
  const ctx: OverdriveThreadContext = {
    conversation_key: scrape.conversation_key,
    last_inbound_hash: scrape.last_inbound_hash,
    last_inbound_text: scrape.last_inbound_text,
    thread_history: scrape.recent_messages,
    listing: qualification.vehicle_hint
      ? {
          title: qualification.listing_title_hint || null,
          url: scrape.url,
          year: qualification.vehicle_hint.year || null,
          make: qualification.vehicle_hint.make || null,
          model: qualification.vehicle_hint.model || null,
        }
      : null,
    stage_hint: state.stage,
  };

  let reply: OverdriveReplyResponse;
  try {
    reply = await requestOverdriveReply(ctx);
  } catch (err: any) {
    deps.emitEvent({
      type: 'overdrive.skipped',
      conversation_key: scrape.conversation_key,
      payload: { reason: 'reply_api_failed', error: err?.message || 'unknown' },
    });
    return {
      attempted: true,
      skipped_reason: 'reply_api_failed',
      qualification,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Escalation short-circuit — server said stop, we log + notify but
  // never inject.
  if (reply.escalate) {
    await recordReplyOutcome(scrape.conversation_key, {
      stage: 'escalated',
      last_inbound_hash: scrape.last_inbound_hash,
      escalated_reason: reply.escalation_reason || 'server_escalation',
    });
    deps.emitEvent({
      type: 'overdrive.escalated',
      conversation_key: scrape.conversation_key,
      payload: {
        reason: reply.escalation_reason,
        stage: reply.next_stage,
      },
    });
    return {
      attempted: true,
      qualification,
      reply,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Step 4: pre-send jitter
  const delay = buildSafetyDelay(reply.reply_text || '');
  await delay.waitBeforeInject();

  // Step 5: inject text
  const injectOk = await deps.injectText(reply.reply_text || '');
  if (!injectOk) {
    deps.emitEvent({
      type: 'overdrive.send_unverified',
      conversation_key: scrape.conversation_key,
      payload: { reason: 'inject_failed', stage: reply.next_stage },
    });
    return {
      attempted: true,
      skipped_reason: 'inject_failed',
      qualification,
      reply,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Step 6: typing simulation
  await delay.waitAfterInject();

  // Step 7: if AI-question, attach photo before send
  let attach: OrchestratorResult['attach'] | undefined;
  if (reply.ai_question_triggered && reply.photo_data_url) {
    const attachResult = await overdriveAttachPhoto(reply.photo_data_url);
    attach = { ok: attachResult.ok, method: attachResult.method };
    // If attach failed, we still send the text reply.
  }

  // Step 8: DOM-verified send
  const sendResult = await overdriveSend(reply.reply_text || '');

  if (!sendResult.ok || !sendResult.verified) {
    deps.emitEvent({
      type: 'overdrive.send_unverified',
      conversation_key: scrape.conversation_key,
      payload: {
        reason: sendResult.error || 'send_verification_failed',
        method: sendResult.method,
        attempts: sendResult.attempts,
      },
    });
    // Record but don't advance replies_today counter — the reply
    // never landed.
    await recordReplyOutcome(scrape.conversation_key, {
      last_inbound_hash: scrape.last_inbound_hash,
      verified: false,
    });
    return {
      attempted: true,
      skipped_reason: 'send_unverified',
      qualification,
      reply,
      send: { ok: false, method: sendResult.method, verified: false },
      attach,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Step 9: persist state + log
  await recordReplyOutcome(scrape.conversation_key, {
    stage: reply.next_stage as OverdriveStage,
    last_inbound_hash: scrape.last_inbound_hash,
    verified: true,
    ai_question_triggered: reply.ai_question_triggered,
    listing_title: ctx.listing?.title || undefined,
    vehicle_year: ctx.listing?.year || undefined,
    vehicle_make: ctx.listing?.make || undefined,
    vehicle_model: ctx.listing?.model || undefined,
  });

  deps.emitEvent({
    type: 'overdrive.replied',
    conversation_key: scrape.conversation_key,
    payload: {
      stage: reply.next_stage,
      ai_question_triggered: reply.ai_question_triggered,
      method: sendResult.method,
      latency_ms: Date.now() - startedAt,
      reply_len: (reply.reply_text || '').length,
      attach_ok: attach?.ok || false,
      attach_method: attach?.method || null,
    },
  });

  return {
    attempted: true,
    qualification,
    reply,
    send: { ok: true, method: sendResult.method, verified: true },
    attach,
    latency_ms: Date.now() - startedAt,
  };
}

/**
 * Detect whether a stage is a hero event that the GM dashboard
 * should light up. Used by the caller to choose which chrome.notification
 * pattern to fire.
 */
export function isHeroStage(stage: string): boolean {
  return stage === 'appointment_set';
}
