import { describe, expect, it } from 'vitest';
import { shouldDropCarriedOverPin } from '../../entrypoints/lib/pinnedThreadCarryover';

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
