import { describe, expect, test } from 'vitest';
import { lastReadableInboundFromHistory } from '../../entrypoints/lib/overdrive/contentBridge';

describe('Overdrive inbound fallback never returns the rep line', () => {
  test('rep spoke last: no inbound', () => {
    expect(lastReadableInboundFromHistory(['Customer: is it available?', 'Rep: Hey Mike, still interested in the 2021 Tahoe?'])).toBe('');
  });
  test('rep-only thread: no inbound', () => {
    expect(lastReadableInboundFromHistory(['Rep: Hey Mike, still interested?'])).toBe('');
  });
  test('customer spoke last: their line', () => {
    expect(lastReadableInboundFromHistory(['Rep: We have it', 'Customer: Can I see it Saturday?'])).toBe('Can I see it Saturday?');
  });
});
