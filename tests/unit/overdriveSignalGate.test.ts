import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockedVerdictDeduper, isOverdriveThreadKey } from '../../entrypoints/lib/overdrive/signalGate';
import { install, setInboundSignatureReader, uninstall } from '../../entrypoints/lib/overdrive/overdriveDetector';
import type { DetectionSignal } from '../../entrypoints/lib/overdrive/types';

describe('Overdrive send_blocked storm', () => {
  it('only thread keys are evaluated (production storm keys are not)', () => {
    expect(isOverdriveThreadKey('path:/')).toBe(false);
    expect(isOverdriveThreadKey('path:/photo/')).toBe(false);
    expect(isOverdriveThreadKey('unknown:1727300000000')).toBe(false);
    expect(isOverdriveThreadKey('t:1002003004')).toBe(true);
    expect(isOverdriveThreadKey('mp:998877')).toBe(true);
  });

  it('reports a blocked verdict once per conversation + inbound hash', () => {
    const shouldReport = createBlockedVerdictDeduper();
    const verdict = { conversation_key: 't:1', inbound_hash: 'abc', source: 'eligibility_gate', reason: 'overdrive_go_light_not_green' };
    const sent = Array.from({ length: 2205 }, () => shouldReport(verdict)).filter(Boolean);
    expect(sent).toHaveLength(1);
    expect(shouldReport({ ...verdict, inbound_hash: 'def' })).toBe(true);
    expect(shouldReport({ ...verdict, conversation_key: 't:2' })).toBe(true);
  });

  it('stays bounded', () => {
    const shouldReport = createBlockedVerdictDeduper(2);
    shouldReport({ conversation_key: 't:1', reason: 'x' });
    shouldReport({ conversation_key: 't:2', reason: 'x' });
    shouldReport({ conversation_key: 't:3', reason: 'x' });
    expect(shouldReport({ conversation_key: 't:1', reason: 'x' })).toBe(true);
  });
});

describe('Overdrive detector', () => {
  afterEach(() => {
    uninstall();
    setInboundSignatureReader(null);
    vi.useRealTimers();
    document.title = '';
  });

  function arm(path: string, sig: { value: string }): DetectionSignal[] {
    vi.useFakeTimers();
    window.history.pushState({}, '', path);
    document.title = 'Messenger';
    document.body.innerHTML = '<div role="main"></div>';
    setInboundSignatureReader(() => sig.value);
    const signals: DetectionSignal[] = [];
    install((s) => signals.push(s));
    return signals;
  }

  it('emits nothing on pages that are not a message thread', () => {
    const signals = arm('/photo/', { value: '' });
    document.title = '(2) Facebook';
    vi.advanceTimersByTime(1100);
    expect(signals).toHaveLength(0);
  });

  it('title unread for ANOTHER chat does not claim a new inbound in the open thread', () => {
    const signals = arm('/messages/t/111/', { value: 'hash-old-inbound' });
    vi.advanceTimersByTime(800);
    document.title = '(1) Messenger';
    vi.advanceTimersByTime(1100);
    const title = signals.filter((s) => s.type === 'title_unread_count');
    expect(title).toHaveLength(1);
    expect(title[0].trigger_origin).toBe('thread_open_or_focus');
  });

  it('title unread with a new inbound in the open thread still fires', () => {
    const sig = { value: 'hash-old-inbound' };
    const signals = arm('/messages/t/111/', sig);
    vi.advanceTimersByTime(800);
    sig.value = 'hash-new-inbound';
    document.title = '(1) Messenger';
    vi.advanceTimersByTime(1100);
    const title = signals.filter((s) => s.type === 'title_unread_count');
    expect(title[0].trigger_origin).toBe('unread_or_new_inbound');
  });
});
