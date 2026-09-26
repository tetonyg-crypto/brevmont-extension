import { describe, expect, it } from 'vitest';
import { didPlatformChange, shouldDropCarriedOverPin } from '../../entrypoints/lib/pinnedThreadCarryover';

describe('pinned customer across a thread switch', () => {
  const pin = { pinThreadKey: '/messages/t/111', pinName: 'Maria Lopez' };

  it('drops the previous customer when the new thread name is unreadable', () => {
    expect(shouldDropCarriedOverPin({ ...pin, currentThreadKey: '/messages/t/222', currentName: '' })).toBe(true);
  });

  it('drops it when the new thread names someone else', () => {
    expect(shouldDropCarriedOverPin({ ...pin, currentThreadKey: '/messages/t/222', currentName: 'John Doe' })).toBe(true);
  });

  it('keeps it when the new thread name is read and matches', () => {
    expect(shouldDropCarriedOverPin({ ...pin, currentThreadKey: '/messages/t/222', currentName: 'maria  lopez' })).toBe(false);
  });

  it('keeps it on the same thread even while the name is unreadable', () => {
    expect(shouldDropCarriedOverPin({ ...pin, currentThreadKey: '/messages/t/111', currentName: '' })).toBe(false);
  });

  it('does not act without a thread signal on both sides', () => {
    expect(shouldDropCarriedOverPin({ ...pin, currentThreadKey: '', currentName: '' })).toBe(false);
    expect(shouldDropCarriedOverPin({ pinThreadKey: null, pinName: 'Maria', currentThreadKey: 'wa_header:x', currentName: '' })).toBe(false);
  });
});

// 2026-09-26 regression: an Instagram lead (cardogvlogs) survived a switch
// to WhatsApp because nothing independently checked "did the platform
// itself change" -- the per-platform signal comparisons in
// sidepanel/main.ts's poller go quiet across a platform boundary (see
// didPlatformChange's own doc comment), so the stale pin's name check
// silently passed while the new platform had not read a name yet.
describe('platform-change detection (independent of same-platform signals)', () => {
  it('flags a real platform change', () => {
    expect(didPlatformChange('instagram', 'whatsapp')).toBe(true);
  });

  it('does not flag staying on the same platform', () => {
    expect(didPlatformChange('whatsapp', 'whatsapp')).toBe(false);
  });

  it('flags the very first tick (unset previous platform)', () => {
    expect(didPlatformChange('', 'instagram')).toBe(true);
  });
});
