import { expect, test } from '@playwright/test';
import { shouldReply, emptyState } from '../entrypoints/lib/overdrive/stateMachine';

const caps = { per_thread_per_minute: 5, per_thread_per_day: 20, per_rep_per_day: 50 };

// Regression guard for the C1 bug: a rep opening an old, never-engaged thread
// (fresh local state → last_reply_at null → hash-dedup can't catch it) must NOT
// auto-fire. The only thing that blocks it is the trigger_origin gate.
test('shouldReply blocks auto-fire when the rep merely opened an old thread', () => {
  const decision = shouldReply({
    state: emptyState('conv-open'),
    last_inbound_hash: 'hash-abc',
    last_inbound_text: 'is this still available?',
    now: Date.now(),
    caps,
    rep_replies_today: 0,
    rep_currently_typing_in_thread: false,
    trigger_origin: 'thread_open_or_focus',
  });
  expect(decision.should).toBe(false);
  expect(decision.reason).toBe('thread_opened_not_new_message');
});

test('shouldReply allows a genuine new inbound on a fresh thread', () => {
  const decision = shouldReply({
    state: emptyState('conv-new'),
    last_inbound_hash: 'hash-xyz',
    last_inbound_text: 'is this still available?',
    now: Date.now(),
    caps,
    rep_replies_today: 0,
    rep_currently_typing_in_thread: false,
    trigger_origin: 'unread_or_new_inbound',
  });
  expect(decision.should).toBe(true);
  expect(decision.reason).toBe('ok');
});

// undefined trigger_origin must remain allowed (legacy/manual callers and the
// coarse conversation-list signal that doesn't set it) — fail-closed here would
// make Overdrive miss genuinely-new inbound messages.
test('shouldReply allows when trigger_origin is undefined (legacy path)', () => {
  const decision = shouldReply({
    state: emptyState('conv-legacy'),
    last_inbound_hash: 'hash-legacy',
    last_inbound_text: 'hello?',
    now: Date.now(),
    caps,
    rep_replies_today: 0,
    rep_currently_typing_in_thread: false,
  });
  expect(decision.should).toBe(true);
  expect(decision.reason).toBe('ok');
});
