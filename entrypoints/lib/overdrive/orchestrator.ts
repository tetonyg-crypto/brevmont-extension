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
import { requestOverdriveReply, confirmOverdriveSend } from './apiClient';
import type { OverdriveReplyResponse, OverdriveSendConfirmPayload } from './apiClient';
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
   * Clear the composer only when it still contains the Overdrive draft
   * we wrote. Used after unsafe-output blocks and send verification
   * failures so a bad autonomous draft never sits in the rep's box.
   */
  clearInjectedText?: (text: string) => Promise<boolean>;

  /**
   * Reacquire the composer after a first-inject miss. Marketplace's
   * inline composer collapses on scroll or when a sub-panel opens; a
   * single scrollIntoView + re-query catches this. Returns true when
   * the composer is now reachable so the orchestrator can retry inject
   * exactly once. Optional so callers that don't wire it still work.
   */
  reacquireComposer?: () => Promise<boolean>;

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

const UNSAFE_OVERDRIVE_REPLY_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: 'clarifying_meta', re: /\bi\s+need\s+to\s+clarify\b/i },
  { reason: 'clarifying_meta', re: /\b(?:need|needs)\s+(?:more|a bit more)?\s*context\b/i },
  { reason: 'self_reference', re: /\b(?:my|own)\s+previous\s+reply\b/i },
  { reason: 'self_reference', re: /\bprevious\s+(?:reply|message)\s+that\s+got\s+echoed\b/i },
  { reason: 'self_reference', re: /\bechoed\s+back\b/i },
  { reason: 'thread_meta', re: /\byou(?:'ve| have)\s+asked\s+twice\b/i },
  { reason: 'thread_meta', re: /\balready\s+given\s+you\s+(?:two|2)\s+time\s+slots\b/i },
  { reason: 'internal_label', re: /\b(?:TEXT|EMAIL|CRM NOTE)\b[\s:]/ },
  { reason: 'ai_meta', re: /\b(?:as an ai|i am an ai|i'm an ai|language model|assistant)\b/i },
];

export function unsafeOverdriveReplyReason(text: string): string | null {
  const body = String(text || '').trim();
  if (!body) return 'empty_reply';
  if (body.length > 520) return 'too_long';
  for (const pattern of UNSAFE_OVERDRIVE_REPLY_PATTERNS) {
    if (pattern.re.test(body)) return pattern.reason;
  }
  return null;
}

// ─── Persist-and-replay send-confirm pipeline (1.16.53 Bug B ext) ──
// Before every confirmOverdriveSend fetch, we stash the payload under
// chrome.storage.local.overdrive_pending_confirms[idempotency_key]. On
// success we delete it. On worker wake (background alarm tick, startup,
// or install), we scan the map and re-fire anything < 10min old.
const PENDING_CONFIRMS_KEY = 'overdrive_pending_confirms';
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

interface PendingConfirmEntry {
  queued_at: number;
  payload: OverdriveSendConfirmPayload;
}

async function stashPendingConfirm(payload: OverdriveSendConfirmPayload): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([PENDING_CONFIRMS_KEY]);
    const map = (stored?.[PENDING_CONFIRMS_KEY] as Record<string, PendingConfirmEntry>) || {};
    map[payload.idempotency_key] = { queued_at: Date.now(), payload };
    await chrome.storage.local.set({ [PENDING_CONFIRMS_KEY]: map });
  } catch { /* storage full, non-fatal */ }
}

async function clearPendingConfirm(idempotencyKey: string): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([PENDING_CONFIRMS_KEY]);
    const map = (stored?.[PENDING_CONFIRMS_KEY] as Record<string, PendingConfirmEntry>) || {};
    if (map[idempotencyKey]) {
      delete map[idempotencyKey];
      await chrome.storage.local.set({ [PENDING_CONFIRMS_KEY]: map });
    }
  } catch { /* noop */ }
}

/**
 * Replay any pending confirms that survived a worker suspension.
 * Called by backgroundController on startup, install, and on the
 * keepalive alarm tick. Idempotent — the server dedupes by
 * idempotency_key so re-fires are safe. Drops entries older than
 * PENDING_MAX_AGE_MS since the server's lookup window is 5min and
 * older entries won't resolve to a reply row.
 */
export async function replayPendingConfirms(): Promise<{ replayed: number; dropped: number }> {
  let replayed = 0;
  let dropped = 0;
  try {
    const stored = await chrome.storage.local.get([PENDING_CONFIRMS_KEY]);
    const map = (stored?.[PENDING_CONFIRMS_KEY] as Record<string, PendingConfirmEntry>) || {};
    const now = Date.now();
    const nextMap: Record<string, PendingConfirmEntry> = {};
    for (const [key, entry] of Object.entries(map)) {
      if (now - entry.queued_at > PENDING_MAX_AGE_MS) {
        dropped += 1;
        continue;
      }
      const result = await raceWithTimeout(confirmOverdriveSend(entry.payload), 3000, 'confirm_replay');
      if (result.ok) {
        replayed += 1;
      } else {
        // Keep the entry so a later tick can retry.
        nextMap[key] = entry;
      }
    }
    await chrome.storage.local.set({ [PENDING_CONFIRMS_KEY]: nextMap });
  } catch { /* noop */ }
  return { replayed, dropped };
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
 * Await a fetch-like Promise with a hard timeout. MV3 service workers
 * can be torn down mid-fetch. If the confirm-POST is fire-and-forget
 * the terminal event is lost silently. Await with a 3s ceiling so the
 * orchestrator returns cleanly either way and we can log the timeout.
 */
async function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<{ ok: false; reason: string }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: `${label}_timeout_${ms}ms` }), ms);
    });
    const race = await Promise.race<{ ok: true; value: T } | { ok: false; reason: string }>([
      p.then((value) => ({ ok: true as const, value })).catch((err) => ({ ok: false as const, reason: `${label}_error:${err?.message || 'unknown'}` })),
      timeout,
    ]);
    return race;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Keep the MV3 service worker alive during the orchestrator's pre-send
 * sleep window (jitter + typing time can total ~18s). Calling any
 * chrome API on a 20s interval resets the idle-kill timer. Returns a
 * cancel function the orchestrator MUST call in a finally block.
 */
function startServiceWorkerKeepalive(): () => void {
  let cancelled = false;
  const tick = (): void => {
    if (cancelled) return;
    try {
      chrome.runtime?.getPlatformInfo?.(() => { /* noop — the call itself is the keepalive */ });
    } catch { /* noop */ }
  };
  // Initial tick then every 20s.
  tick();
  const handle = setInterval(tick, 20_000);
  return () => {
    cancelled = true;
    clearInterval(handle);
  };
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
  // Keep the MV3 service worker alive across the pre-send jitter +
  // typing sleep windows. Cancelled in the finally block below so the
  // interval doesn't leak.
  const stopKeepalive = startServiceWorkerKeepalive();
  try {
  return await orchestrateReplyInner(scrape, settings, deps, startedAt);
  } finally {
    stopKeepalive();
  }
}

async function orchestrateReplyInner(
  scrape: ThreadScrape,
  settings: OrchestratorSettings,
  deps: OrchestratorDeps,
  startedAt: number,
): Promise<OrchestratorResult> {
  if (!String(scrape.last_inbound_text || '').trim()) {
    deps.emitEvent({
      type: 'overdrive.skipped',
      conversation_key: scrape.conversation_key,
      payload: { reason: 'no_confident_inbound' },
    });
    return {
      attempted: false,
      skipped_reason: 'no_confident_inbound',
      latency_ms: Date.now() - startedAt,
    };
  }

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

  const unsafeReason = unsafeOverdriveReplyReason(reply.reply_text || '');
  if (unsafeReason) {
    try { await deps.clearInjectedText?.(reply.reply_text || ''); } catch { /* noop */ }
    await recordReplyOutcome(scrape.conversation_key, {
      stage: 'escalated',
      last_inbound_hash: scrape.last_inbound_hash,
      escalated_reason: `unsafe_reply:${unsafeReason}`,
    });
    deps.emitEvent({
      type: 'overdrive.escalated',
      conversation_key: scrape.conversation_key,
      payload: {
        reason: `unsafe_reply:${unsafeReason}`,
        stage: 'escalated',
      },
    });
    return {
      attempted: true,
      skipped_reason: `unsafe_reply:${unsafeReason}`,
      qualification,
      reply,
      latency_ms: Date.now() - startedAt,
    };
  }

  // Step 4: pre-send jitter
  const delay = buildSafetyDelay(reply.reply_text || '');
  await delay.waitBeforeInject();

  // Step 5: inject text
  let injectOk = await deps.injectText(reply.reply_text || '');
  let injectMethodTag: string = 'inject_failed';
  if (!injectOk) {
    // Bug A fix (1.16.53) — one-shot reacquire retry. The Marketplace
    // inline composer collapses on scroll or when a sub-panel opens; a
    // single scroll-into-view + re-query lands a second inject attempt
    // in most cases.
    if (deps.reacquireComposer) {
      try {
        const reacquireOk = await deps.reacquireComposer();
        if (reacquireOk) {
          injectOk = await deps.injectText(reply.reply_text || '');
          if (!injectOk) injectMethodTag = 'inject_failed_after_reacquire';
        }
      } catch { /* noop — treat as failed */ }
    }
  }
  if (!injectOk) {
    try { await deps.clearInjectedText?.(reply.reply_text || ''); } catch { /* noop */ }
    deps.emitEvent({
      type: 'overdrive.send_unverified',
      conversation_key: scrape.conversation_key,
      payload: { reason: injectMethodTag, stage: reply.next_stage },
    });
    // Bug A fix (1.16.53): the inject_failed early-return used to
    // return without posting confirmOverdriveSend, so the server saw
    // reply_generated but never send_unverified. Fire the confirm here
    // with verified=false so the terminal event lands in event_log_v2.
    // Stash the payload FIRST so a worker teardown mid-fetch leaves a
    // record for replay on the next wake.
    const injectFailPayload: OverdriveSendConfirmPayload = {
      conversation_key: scrape.conversation_key,
      idempotency_key: reply.idempotency_key,
      verified: false,
      method: injectMethodTag,
      latency_ms: Date.now() - startedAt,
      attempts: [],
      ai_output: reply.reply_text || '',
      next_stage: reply.next_stage,
      ai_question_triggered: !!reply.ai_question_triggered,
      attach_ok: false,
      attach_method: null,
    };
    await stashPendingConfirm(injectFailPayload);
    const injectFailConfirm = await raceWithTimeout(
      confirmOverdriveSend(injectFailPayload),
      3000,
      'confirm_inject_failed',
    );
    if (injectFailConfirm.ok) {
      await clearPendingConfirm(reply.idempotency_key);
    }
    return {
      attempted: true,
      skipped_reason: injectMethodTag,
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

  // Migration 310 write-through: server writes the terminal event
  // (overdrive.reply_sent | overdrive.appointment_set |
  // overdrive.photo_sent | overdrive.send_unverified) based on
  // what we report here. Fire-and-forget — never gate return on
  // the confirm response.
  const confirmPayload: OverdriveSendConfirmPayload = {
    conversation_key: scrape.conversation_key,
    idempotency_key: reply.idempotency_key,
    verified: !!(sendResult.ok && sendResult.verified),
    method: sendResult.method || 'not_attempted',
    latency_ms: Date.now() - startedAt,
    attempts: sendResult.attempts || [],
    ai_output: reply.reply_text || '',
    next_stage: reply.next_stage,
    ai_question_triggered: !!reply.ai_question_triggered,
    attach_ok: attach?.ok || false,
    attach_method: attach?.method || null,
  };
  // Bug B fix (1.16.53): stash the payload to chrome.storage.local
  // BEFORE the fetch so a worker teardown mid-fetch leaves a record
  // the next-wake replay pass will re-fire. Await the fetch with a
  // 3s ceiling; on success clear the pending entry. On timeout, emit
  // a local event AND leave the pending entry so replay picks it up.
  await stashPendingConfirm(confirmPayload);
  const confirmResult = await raceWithTimeout(
    confirmOverdriveSend(confirmPayload),
    3000,
    'confirm_send',
  );
  if (confirmResult.ok) {
    await clearPendingConfirm(reply.idempotency_key);
  } else {
    try {
      deps.emitEvent({
        type: 'overdrive.send_unverified',
        conversation_key: scrape.conversation_key,
        payload: {
          reason: 'send_confirm_timeout',
          detail: confirmResult.reason,
          idempotency_key: reply.idempotency_key,
          confirm_payload: confirmPayload,
        },
      });
    } catch { /* noop */ }
  }

  if (!sendResult.ok || !sendResult.verified) {
    try { await deps.clearInjectedText?.(reply.reply_text || ''); } catch { /* noop */ }
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
