import { describe, expect, it } from 'vitest';
import {
  classifyXBubble,
  isXNoiseText,
  normalizeXText,
} from '../../entrypoints/lib/xMessageText';

describe('normalizeXText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeXText('  Hey   there\n\nfriend  ')).toBe('Hey there friend');
  });
  it('handles non-string input safely', () => {
    expect(normalizeXText(null)).toBe('');
    expect(normalizeXText(undefined)).toBe('');
  });
});

describe('isXNoiseText', () => {
  it('rejects presence/typing chrome', () => {
    expect(isXNoiseText('is typing...')).toBe(true);
    expect(isXNoiseText('Cardog is typing…')).toBe(true);
  });

  it('rejects read-receipt labels', () => {
    expect(isXNoiseText('Seen')).toBe(true);
    expect(isXNoiseText('Delivered')).toBe(true);
    expect(isXNoiseText('Seen by cardog_official')).toBe(true);
    expect(isXNoiseText('Seen 2:41 PM')).toBe(true);
  });

  it('rejects reaction sentences', () => {
    expect(isXNoiseText('Reacted ❤️ to this')).toBe(true);
    expect(isXNoiseText('You reacted 😂 to Is the Tahoe still available')).toBe(true);
  });

  it('rejects bare timestamp and date-divider rows', () => {
    expect(isXNoiseText('2:41 PM')).toBe(true);
    expect(isXNoiseText('Yesterday 9:14 AM')).toBe(true);
    expect(isXNoiseText('Sep 12')).toBe(true);
  });

  it('rejects empty/whitespace-only text', () => {
    expect(isXNoiseText('')).toBe(true);
    expect(isXNoiseText('   ')).toBe(true);
  });

  it('accepts real sales-conversation text', () => {
    expect(isXNoiseText('Is the 2021 Tahoe still available?')).toBe(false);
    expect(isXNoiseText('yes! 🔥 can you send pics')).toBe(false);
    expect(isXNoiseText('check this out https://example.com/listing')).toBe(false);
  });
});

describe('classifyXBubble', () => {
  it('passes plain text through unchanged', () => {
    expect(classifyXBubble({ text: 'Is the Tahoe still available?' })).toEqual({
      text: 'Is the Tahoe still available?',
      contentType: 'text',
    });
  });

  it('preserves emoji in plain text', () => {
    expect(classifyXBubble({ text: 'yes!! 🔥🔥 so hyped' })).toEqual({
      text: 'yes!! 🔥🔥 so hyped',
      contentType: 'text',
    });
  });

  it('keeps a link as normal text (V1 does not need a link placeholder)', () => {
    const result = classifyXBubble({ text: 'check the listing https://dealer.example.com/inv/123' });
    expect(result.contentType).toBe('text');
    expect(result.text).toContain('https://dealer.example.com/inv/123');
  });

  it('flags a deleted/unsent message without inventing content', () => {
    expect(classifyXBubble({ text: 'This message was deleted' })).toEqual({
      text: '[deleted message]',
      contentType: 'unsent',
    });
  });

  it('labels a shared post/tweet permalink as a typed placeholder', () => {
    expect(classifyXBubble({ text: '', postHref: '/cardog_official/status/1234567890123456789' })).toEqual({
      text: '[shared a post]',
      contentType: 'shared_post',
    });
  });

  it('keeps a caption when a shared post also has text', () => {
    expect(classifyXBubble({ text: 'check this out', postHref: '/cardog_official/status/1234567890123456789' })).toEqual({
      text: 'check this out',
      contentType: 'shared_post',
    });
  });

  it('does not misclassify a profile link (no /status/) as a shared post', () => {
    const result = classifyXBubble({ text: 'follow me', postHref: '/cardog_official' });
    expect(result.contentType).toBe('text');
  });

  it('labels a voice message without transcribing it', () => {
    expect(classifyXBubble({ text: '', hasAudio: true })).toEqual({
      text: '[voice message]',
      contentType: 'voice',
    });
  });

  it('labels a GIF-only bubble distinctly from a video', () => {
    expect(classifyXBubble({ text: '', isGif: true })).toEqual({
      text: '[GIF]',
      contentType: 'gif',
    });
  });

  it('labels an image-only bubble without hallucinating a caption', () => {
    expect(classifyXBubble({ text: '', hasImage: true })).toEqual({
      text: '[shared a photo]',
      contentType: 'photo',
    });
  });

  it('labels a video-only bubble without hallucinating a caption', () => {
    expect(classifyXBubble({ text: '', hasVideo: true })).toEqual({
      text: '[shared a video]',
      contentType: 'video',
    });
  });

  it('returns unknown_rich (empty text) rather than guessing when nothing is legible', () => {
    expect(classifyXBubble({ text: '' })).toEqual({ text: '', contentType: 'unknown_rich' });
  });
});
