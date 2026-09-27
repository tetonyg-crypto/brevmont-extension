import { describe, expect, it } from 'vitest';
import { conversationKeyForPath } from '../../entrypoints/lib/overdrive/contentBridge';

describe('Radar conversation keys', () => {
  it('uses the same msg namespace as the catch-up sweep for Facebook Messages', () => {
    expect(conversationKeyForPath('/messages/t/BRI123')).toBe('msg:BRI123');
    expect(conversationKeyForPath('/t/BRI123')).toBe('msg:BRI123');
  });

  it('keeps Marketplace threads in the mp namespace', () => {
    expect(conversationKeyForPath('/marketplace/t/BUYER123')).toBe('mp:BUYER123');
  });
});
