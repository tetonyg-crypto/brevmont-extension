import { describe, expect, it } from 'vitest';
import { instagramBubbleSide } from '../../entrypoints/lib/instagramMessageText';

// Recreates the live Gaaabby<3 layout (2026-09-25): [role="main"] spans the
// inbox list (x 0-480) AND the thread (x 480-1080). The old code split on the
// midpoint of [role="main"] (x 540), so every thread bubble -- including
// Gabby's own left-aligned gray ones at x ~500 -- read as "outbound".
describe('instagramBubbleSide', () => {
  const main = { left: 0, width: 1080 };
  const threadPane = { left: 480, width: 600 };
  const gabbyBubble = { left: 500, width: 330 };    // "How many girls do you talk to like this"
  const repBubble = { left: 760, width: 300 };      // "Babe why do you think you aren't special"
  const shortInbound = { left: 500, width: 60 };    // "Bet"
  const shortOutbound = { left: 1000, width: 60 };  // "Bet"
  const inboxPreview = { left: 20, width: 420 };    // "Gaaabby<3 · You: Babe why do you thi..."

  it('reproduces the live bug when measured against [role="main"]', () => {
    // Gabby's own inbound bubble reads as outbound -- exactly what was logged.
    expect(instagramBubbleSide(gabbyBubble, main)).toBe('outbound');
    expect(instagramBubbleSide(shortInbound, main)).toBe('inbound');
  });

  it('classifies against the thread pane correctly', () => {
    expect(instagramBubbleSide(gabbyBubble, threadPane)).toBe('inbound');
    expect(instagramBubbleSide({ left: 560, width: 200 }, threadPane)).toBe('inbound');
    expect(instagramBubbleSide(repBubble, threadPane)).toBe('outbound');
    expect(instagramBubbleSide(shortInbound, threadPane)).toBe('inbound');
    expect(instagramBubbleSide(shortOutbound, threadPane)).toBe('outbound');
  });

  it('drops inbox-list rows left of the thread column', () => {
    expect(instagramBubbleSide(inboxPreview, threadPane)).toBe('outside');
  });

  it('full-width rows (timestamps, system lines) stay unknown', () => {
    expect(instagramBubbleSide({ left: 480, width: 580 }, threadPane)).toBe('unknown');
  });

  it('unmeasurable boxes stay unknown', () => {
    expect(instagramBubbleSide({ left: 0, width: 0 }, threadPane)).toBe('unknown');
    expect(instagramBubbleSide(gabbyBubble, { left: 0, width: 0 })).toBe('unknown');
  });
});
